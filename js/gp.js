/* ═══════════════════════════════════════════════════════════
   MXGP Live Timing — gp.js  v2.0  (Multi-GP + Saison)

   Stockage Firebase : /gp/{weekKey}/cats/{cat}/races/{raceKey}
   SSE sur /gp.json  → TOUS les GPs chargés en temps réel

   Pas de reset vendredi : toute la saison est visible.

   API (window.GP) :
     GP.update(riders, meta)       — appelé par main.js
     GP.autoCapture(riders, meta)  — appelé quand status=Finished
     GP.init()
     GP.setCurrent(cat, sess)
═══════════════════════════════════════════════════════════ */

const GP = (() => {
  /* ─────────────────────────────────────────────────────────
     FIREBASE
  ───────────────────────────────────────────────────────── */
  const FB_BASE =
    "https://livetiming-d4c0b-default-rtdb.europe-west1.firebasedatabase.app";

  /* ─────────────────────────────────────────────────────────
     COULEURS PAR CATÉGORIE
  ───────────────────────────────────────────────────────── */
  const CAT_COLORS = {
    MXGP: "#e8002d", // Rouge — Championnat du monde 450
    MX2: "#0057b8", // Bleu — Championnat du monde 250
    WMX: "#9c27b0", // Violet — Championnat du monde féminin
    EMX250: "#00a651", // Vert — Championnat d'Europe 250
    EMX125: "#ff8800", // Orange — Championnat d'Europe 125
    EMXOPEN: "#757575", // Gris — Open
    MXON: "#f5c400", // Jaune/or — FIM Motocross of Nations
    EMX85: "#00bcd4", // Cyan — Championnat d'Europe 85
    EMX65: "#e91e63", // Rose/magenta — Championnat d'Europe 65
    EMX2T: "#5d4037", // Marron foncé — Championnat d'Europe 2T
    EMXOPEN: "#9e9e9e", // Gris clair — Championnat d'Europe Open
  };

  function _catColor(cat) {
    if (!cat) return "#888888";
    const k = String(cat).toUpperCase().trim();
    return CAT_COLORS[k] || "#888888";
  }

  /* ─────────────────────────────────────────────────────────
     BARÈME FIM
  ───────────────────────────────────────────────────────── */
  const PTS_RACE = [
    25, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
  ];
  const PTS_QR = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const LIVE_THROTTLE_MS = 15_000; // conservé pour _startLiveLoop (panel ouvert) — voir plus bas

  /* ── Écriture live ÉVÉNEMENTIELLE ────────────────────────────
     Au lieu d'un timer fixe, on écrit uniquement quand le classement
     PARMI LES POSITIONS QUI RAPPORTENT DES POINTS change réellement —
     un pilote qui gagne/perd des places hors de la zone à points ne
     déclenche aucune écriture inutile.
     LIVE_DEBOUNCE_MS  : regroupe les changements quasi simultanés
                          (ex. plusieurs pilotes qui se doublent au
                          même passage ligne) en une seule écriture.
     LIVE_HEARTBEAT_MS : filet de sécurité — force une ré-écriture
                          même sans changement de classement, pour que
                          le timestamp affiché reste "frais" durant une
                          phase calme de la course. ──────────────── */
  const LIVE_DEBOUNCE_MS = 1_200;
  const LIVE_HEARTBEAT_MS = 30_000;
  let _liveLastSig = null; // signature du dernier classement à points écrit
  let _liveLastWriteTs = 0; // timestamp de la dernière écriture réussie
  let _liveDebounceTmr = null; // regroupement des changements rapprochés
  const RACE_LABEL = {
    QR: "Qual. Race",
    R1: "Race 1",
    R2: "Race 2",
    R3: "Race 3",
  };
  const RACE_ORDER = ["QR", "R1", "R2", "R3"];

  /* ─────────────────────────────────────────────────────────
     FIM MOTOCROSS OF NATIONS
     Événement annuel unique, catégorie pseudo "MXON" :
       - Race 1 : MXGP + MX2
       - Race 2 : MX2  + Open
       - Race 3 : MXGP + Open
     Classement par pilote (position irrespective of class) = pts.
     Classement par NATION = 5 meilleurs résultats sur 6
     (2 pilotes par course × 3 courses), on retire le plus mauvais.
     Les Qualifying Races du samedi ne comptent pas pour ce classement.

     Détection combinée (fenêtre de dates + mots-clés dans le flux
     live) pour être fiable même sans intervention pendant l'event.
  ───────────────────────────────────────────────────────── */
  const MXON_CAT = "MXON";
  // Fenêtre large (Ve→Lu) autour du week-end du 2-4 octobre 2026,
  // en clé YYYY-MM-DD (comparaison de chaînes, ordre lexicographique OK).
  const MXON_WK_START = "2026-10-01";
  const MXON_WK_END = "2026-10-05";

  /* Interrupteur de TEST manuel — permet de forcer le mode MXoN sur
     n'importe quelle session live actuelle, sans attendre la date réelle.
     Activation : URL avec ?mxontest=1, ou dans la console : GP.testMxon(true) */
  let _forceMxon = false;

  /* ── Mode test MXoN : mapping catégorie réelle → créneau R1/R2/R3 ──
     Sur un GP normal, plusieurs vraies catégories (MX2, MXGP, EMX...)
     ont chacune leur propre "Race 1"/"Race 2" — sans ce mapping, elles
     s'écraseraient toutes sous la même clé une fois forcées en MXON
     (la clé de session normale ignore la catégorie). On assigne un
     créneau unique par catégorie réelle rencontrée, dans l'ordre
     d'arrivée, jusqu'à 3 — exactement comme les 3 vraies manches du
     MXoN. Permet de tester TOUT le pipeline (agrégation, retrait du
     pire résultat, classement par nation) sur un GP classique, avant
     le vrai jour. Ne s'applique QUE si _forceMxon est actif
     manuellement — jamais le jour réel (où le flux enverra
     directement de vraies clés R1/R2/R3, sans ambiguïté). */
  let _mxonTestSlots = {}; // catégorie réelle → "R1" | "R2" | "R3"
  const _mxonTestSlotOrder = ["R1", "R2", "R3"];

  function _mxonTestSlotFor(realCat) {
    if (!realCat) return null;
    if (_mxonTestSlots[realCat]) return _mxonTestSlots[realCat];
    const used = Object.values(_mxonTestSlots);
    const next = _mxonTestSlotOrder.find((s) => !used.includes(s));
    if (!next) return null; // déjà 3 catégories réelles différentes vues
    _mxonTestSlots[realCat] = next;
    console.log(`[GP] MXoN TEST — "${realCat}" assigné au créneau ${next}`);
    return next;
  }

  function _isMxonWeekByDate() {
    const wk = _weekKey();
    return _forceMxon || (wk >= MXON_WK_START && wk <= MXON_WK_END);
  }

  function _looksLikeMxonText(meta) {
    if (!meta) return false;
    const s =
      `${meta.title || ""} ${meta.category || ""} ${meta.sessType || ""}`.toLowerCase();
    return /nation|mxon/.test(s);
  }

  /** Vrai si la session courante appartient au FIM Motocross of Nations
   *  — combine détection par date ET par texte du flux live, pour être
   *  fiable même si l'un des deux signaux est absent/imprévu. */
  function _isMxonSession(meta) {
    return _isMxonWeekByDate() || _looksLikeMxonText(meta);
  }

  /** Barème de points pour un résultat de course.
   *  MXoN : la position EST le nombre de points (1er = 1pt, irrespective
   *  of class) — pas de barème 25/22/20…, et pas de points pour la QR. */
  function _ptsFor(cat, key, pos, idx) {
    if (cat === MXON_CAT) return key === "QR" ? 0 : pos;
    const scale = key === "QR" ? PTS_QR : PTS_RACE;
    return scale[idx] || 0;
  }

  /* ─────────────────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────────────────── */
  let allGPs = {}; // { "2025-03-14": { cats:{}, live:null }, … }
  let latestRiders = [];
  let latestMeta = null;
  let cachedMeta = null;
  let currentCat = "";
  let currentSess = "";
  let panel = null;
  let isOpen = false;
  let notifTimer = null;
  let _sseConn = null;
  let _liveTimer = null;
  let _liveRefresh = null;
  let _toastTimer = null;
  let _statsRenderTimer = null;

  // Navigation
  let activeWeek = null; // weekKey ("2025-03-14") | "season" | null
  let activeCat = "";
  let activeTab = "GP"; // "GP" | "QR" | "R1" | "R2"
  let activeSeason = null; // année string ex. "2025"

  /* ─────────────────────────────────────────────────────────
     WEEK KEY — pour les écritures uniquement
  ───────────────────────────────────────────────────────── */
  /** Retourne la clé YYYY-MM-DD du week-end GP en cours.
   *
   *  Stratégie (évite les doubles entrées en DB sur un week-end Samedi/Dimanche) :
   *    Pass 1 — cherche la clé LA PLUS ANCIENNE (i part de 3 jours) ayant
   *             déjà des résultats sauvegardés (cats avec races).
   *             → Le dimanche, la clé du samedi (QR) est trouvée en premier
   *               et les R1/R2 sont sauvés sous la même date.
   *    Pass 2 — si aucun résultat sauvé, prend la clé la plus ancienne avec
   *             n'importe quelle donnée (live session en cours).
   *    Fallback — aujourd'hui (nouveau week-end, rien en DB encore).
   */
  function _weekKey() {
    const today = new Date();
    const candidates = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      candidates.push(d.toISOString().slice(0, 10));
    }

    // Pass 1 : clé avec des races sauvegardées (résultat réel)
    for (const key of candidates) {
      const gp = allGPs[key];
      if (
        gp?.cats &&
        Object.values(gp.cats).some(
          (c) => c?.races && Object.keys(c.races).length > 0,
        )
      )
        return key;
    }

    // Pass 2 : n'importe quelle clé existante (live uniquement, pas encore de résultat)
    for (const key of candidates) {
      if (allGPs[key]) return key;
    }

    // Fallback : aujourd'hui
    return candidates[candidates.length - 1]; // = today (i=0 est ajouté en dernier)
  }

  /* Chemin Firebase d'une semaine, avec le niveau "année" ajouté en
     plus (ex: /gp/2026/2026-08-01) — la clé de semaine elle-même ne
     change pas, on ajoute juste un niveau de regroupement au-dessus.
     Centralisé ici pour n'avoir qu'un seul endroit à maintenir. */
  function _wkBase(wk) {
    return `${FB_BASE}/gp/${wk.slice(0, 4)}/${wk}`;
  }

  /* ─────────────────────────────────────────────────────────
     NORMALISATION SESSION / CATÉGORIE
  ───────────────────────────────────────────────────────── */
  function _normalizeSessionType(sessType) {
    if (!sessType) return null;
    const s = String(sessType).trim().toLowerCase();
    if (s.includes("qualif")) return "QR";
    if (s.match(/race\s*1\b/)) return "R1";
    if (s.match(/race\s*2\b/)) return "R2";
    if (s.match(/race\s*3\b/)) return "R3"; // FIM Motocross of Nations — 3e course
    if (s.match(/race1/)) return "R1";
    if (s.match(/race2/)) return "R2";
    if (s.match(/race3/)) return "R3";
    /* Libellés alternatifs parfois utilisés (motos, manches numérotées
       autrement) — sécurité supplémentaire, notamment pour le MXoN dont
       on ne connaît pas le libellé exact à l'avance. */
    if (s.match(/\bmoto\s*1\b|\bheat\s*1\b|\b1(st|ère|er)?\s*(moto|heat|leg)\b/))
      return "R1";
    if (s.match(/\bmoto\s*2\b|\bheat\s*2\b|\b2(nd|ème)?\s*(moto|heat|leg)\b/))
      return "R2";
    if (s.match(/\bmoto\s*3\b|\bheat\s*3\b|\b3(rd|ème)?\s*(moto|heat|leg)\b/))
      return "R3";
    return null;
  }

  /* ── Détection MXoN RÉELLE — jour + ordre chronologique ──────────
     On connaît avec certitude, pour ce week-end précis (voir
     MXON_WK_START/END) :
       • MXoN est la SEULE catégorie active (pas d'EMX250/WMX/etc. ce
         week-end-là)
       • Samedi = qualification (1 seule session notée)
       • Dimanche = 3 courses (R1/R2/R3), dans l'ordre chronologique
     On se base donc sur le jour réel + l'ordre d'apparition — PAS sur
     le texte envoyé par le flux, dont le libellé exact n'est pas
     connu à l'avance (contrairement au reste de la saison, où le
     texte est fiable). Free Practice / Warm-up sont explicitement
     exclus : jamais notés, jamais assignés à un créneau. */
  let _mxonRealSeq = {}; // libellé brut de session → clé déjà assignée
  const _mxonRealOrder = ["R1", "R2", "R3"];

  function _mxonRealSessionKey(meta) {
    const label = `${meta.category || ""}|${meta.sessType || ""}|${meta.title || ""}|${meta.time || ""}`
      .trim()
      .toLowerCase();
    if (/practice|warm[\s-]?up/.test(label)) return null; // jamais noté
    /* Catégories support (jeunes / finales de repêchage) présentes le
       même week-end sur le programme officiel, mais hors compétition
       principale par nations — ne doivent jamais consommer un créneau
       R1/R2/R3. Noms de branding stables (contrairement au libellé
       exact des manches principales, qui lui peut varier). */
    if (/blu\s*cru|\bb[\s-]?final\b|\bc[\s-]?final\b/.test(label)) return null;

    if (_mxonRealSeq[label]) return _mxonRealSeq[label]; // déjà assignée

    const isSaturday = new Date().getDay() === 6; // 0=dim … 6=sam
    if (isSaturday) {
      if (Object.values(_mxonRealSeq).includes("QR")) return null; // déjà pris
      _mxonRealSeq[label] = "QR";
      console.log("[GP] MXoN — qualification détectée (samedi) → QR");
      return "QR";
    }

    // Dimanche : prochaine course dans l'ordre d'apparition
    const used = new Set(Object.values(_mxonRealSeq));
    const next = _mxonRealOrder.find((s) => !used.has(s));
    if (!next) return null; // déjà les 3 courses assignées
    _mxonRealSeq[label] = next;
    console.log(
      `[GP] MXoN — course détectée (ordre chronologique, dimanche) → ${next}`,
    );
    return next;
  }

  function _normalizeCat(cat) {
    if (!cat) return "";
    const s = String(cat).trim().toUpperCase();
    if (s === "WOMEN" || s.includes("WOMEN'S") || s === "WMX_F") return "WMX";
    return s;
  }

  function _isChampionshipName(label) {
    if (!label) return false;
    return /championship|grand prix|motocross|supercross/i.test(String(label));
  }

  function _looksLikeClassCode(value) {
    if (!value) return false;
    return /^(WMX|MXGP|MX2|EMX250|EMX125|EMXOPEN|SX1|SX2|SX250|SX125)$/.test(
      String(value).trim().toUpperCase(),
    );
  }

  function _extractClassFromTitle(title) {
    if (!title) return "";
    const m = title.match(
      /\b(WMX|MXGP|MX2|EMX250|EMX125|EMXOPEN|SX1|SX2|SX250|SX125)\b/i,
    );
    return m ? _normalizeCat(m[1]) : "";
  }

  function _inferSessionKey(meta) {
    if (!meta) return null;
    if (_forceMxon) {
      // Mode test manuel — mapping catégorie réelle → créneau (inchangé)
      const realCat = String(meta.category || "").trim();
      const slot = _mxonTestSlotFor(realCat);
      if (slot) return slot;
    } else if (_isMxonWeekByDate()) {
      // Semaine RÉELLE du MXoN — priorité absolue à cette détection,
      // peu importe le texte du flux.
      return _mxonRealSessionKey(meta);
    }
    const rawSess = String(meta.sessType || "").trim();
    const fromSess = _normalizeSessionType(rawSess);
    if (fromSess) return fromSess;
    const fromTime = _normalizeSessionType(String(meta.time || "").trim());
    if (fromTime) return fromTime;
    return _normalizeSessionType(String(meta.title || "").trim());
  }

  function _inferMetaCategory(meta) {
    if (!meta) return "";
    /* FIM Motocross of Nations : la session mixe 2 classes (ex. MXGP+MX2
       en Race 1), donc le champ "category" brut du flux n'est pas fiable.
       On force la pseudo-catégorie MXON dès que la détection combinée
       (date + texte) matche — voir _isMxonSession(). */
    if (_isMxonSession(meta)) return MXON_CAT;
    const rawCat = String(meta.category || "").trim();
    const normCat = _normalizeCat(rawCat);
    const rawSess = String(meta.sessType || "").trim();
    const normSess = _normalizeSessionType(rawSess);
    if (
      normSess === null &&
      _looksLikeClassCode(rawSess) &&
      _isChampionshipName(rawCat)
    )
      return _normalizeCat(rawSess);
    if (normCat) return normCat;
    return _extractClassFromTitle(String(meta.title || ""));
  }

  /* ─────────────────────────────────────────────────────────
     FIREBASE — SSE (lecture de TOUS les GPs)
     SSE sur /gp.json → reçoit l'arborescence complète
  ───────────────────────────────────────────────────────── */
  function _startRealtimeSync() {
    if (_sseConn) {
      try {
        _sseConn.close();
      } catch (e) {}
      _sseConn = null;
    }

    _sseConn = new EventSource(`${FB_BASE}/gp.json`);

    _sseConn.addEventListener("put", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        _applyFirebasePath(msg.path, msg.data);
        _updateSyncIndicator(true);
      } catch (e) {
        console.warn("[GP SSE] put error", e);
      }
    });

    _sseConn.addEventListener("patch", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const base = (msg.path || "/").replace(/\/$/, "");
        Object.entries(msg.data || {}).forEach(([k, v]) => {
          _applyFirebasePath(`${base}/${k}`, v);
        });
        _updateSyncIndicator(true);
      } catch (e) {
        console.warn("[GP SSE] patch error", e);
      }
    });

    _sseConn.addEventListener("cancel", () => {
      console.warn("[GP SSE] cancelled — vérifier les règles Firebase");
      _sseConn.close();
    });

    _sseConn.onerror = () => {
      _updateSyncIndicator(false);
      _sseConn.close();
      _sseConn = null;
      setTimeout(_startRealtimeSync, 10_000);
    };
  }

  function _stopRealtimeSync() {
    if (_sseConn) {
      try {
        _sseConn.close();
      } catch (e) {}
      _sseConn = null;
    }
    _updateSyncIndicator(false);
  }

  /**
   * Applique un événement Firebase SSE à allGPs.
   * Le path est relatif à /gp (ex: "/" | "/2025-03-14/cats/MXGP/races/R1").
   */
  function _applyFirebasePath(path, value) {
    if (!path || path === "/") {
      Object.keys(allGPs).forEach((k) => delete allGPs[k]);
      if (value && typeof value === "object") {
        /* Nouvelle structure : /gp/{année}/{semaine}/... — on aplatit
           ici pour que allGPs[wk] continue de fonctionner PARTOUT
           ailleurs dans le fichier, sans rien changer d'autre.
           Rétrocompatible : une clé qui n'est pas une année à 4
           chiffres (ex. d'anciennes entrées jamais migrées, encore à
           la racine) est gardée telle quelle. */
        Object.entries(value).forEach(([k, v]) => {
          if (/^\d{4}$/.test(k) && v && typeof v === "object") {
            Object.assign(allGPs, v); // conteneur d'année → aplati
          } else {
            allGPs[k] = v; // ancien format, déjà une clé de semaine
          }
        });
      }
    } else {
      let parts = path.replace(/^\//, "").split("/").filter(Boolean);
      // Retirer le segment "année" en tête (nouvelle structure) —
      // reconnu par : 4 chiffres suivis d'une vraie clé de semaine
      // YYYY-MM-DD juste après.
      if (
        parts.length >= 2 &&
        /^\d{4}$/.test(parts[0]) &&
        /^\d{4}-\d{2}-\d{2}$/.test(parts[1])
      ) {
        parts = parts.slice(1);
      }
      let obj = allGPs;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!obj[p] || typeof obj[p] !== "object") obj[p] = {};
        obj = obj[p];
      }
      const last = parts[parts.length - 1];
      if (value === null) delete obj[last];
      else obj[last] = value;
    }

    // Auto-sélection initiale
    if (!activeWeek) {
      const wk = _weekKey();
      const weeks = _sortedWeeks();
      activeWeek = weeks.includes(wk) ? wk : weeks[0] || wk;
    }

    _updateHeaderBtn();
    if (isOpen) _renderBody();
  }

  /* ─────────────────────────────────────────────────────────
     FIREBASE — ÉCRITURE (toujours sur la semaine courante)
  ───────────────────────────────────────────────────────── */
  async function _writeRace(
    cat,
    raceKey,
    raceData,
    catName,
    gpFlag,
    force = false,
  ) {
    /* Seul le script headless (capture.js) écrit désormais en base —
       les corrections manuelles se font directement dans la console
       Firebase. On sort silencieusement, sans tenter le fetch, pour
       ne jamais générer d'erreur 401 ni de bruit dans la console du
       navigateur. */
    if (!window.__MXGP_HEADLESS__) return;
    const wk = _weekKey();
    const base = `${_wkBase(wk)}/cats/${cat}`;
    const raceUrl = `${base}/races/${raceKey}.json`;
    try {
      /* Auto-capture: skip if already saved (protect against double-save).
         Manual capture (force=true): always overwrite — covers red-flag restart. */
      if (!force) {
        const existing = await fetch(raceUrl);
        if (existing.ok) {
          const existingData = await existing.json();
          if (existingData !== null) return;
        }
      }
      const r = await fetch(raceUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raceData),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      if (catName && !allGPs[wk]?.cats?.[cat]?.name) {
        await fetch(`${base}/name.json`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(catName),
        });
      }
      if (gpFlag && !allGPs[wk]?.flag) {
        await fetch(`${_wkBase(wk)}/flag.json`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(gpFlag),
        });
      }
    } catch (e) {
      console.warn("[GP] Firebase write failed:", e);
      _toast("⚠ Firebase save failed", true);
    }
  }

  /* ─────────────────────────────────────────────────────────
     HELPERS — SEMAINES / SAISONS
  ───────────────────────────────────────────────────────── */
  function _sortedWeeks() {
    // N'inclure que les clés de format YYYY-MM-DD (exclut _penalties et autres nœuds spéciaux)
    return Object.keys(allGPs)
      .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
      .sort((a, b) => b.localeCompare(a)); // newest first
  }

  function _sortedCatsForWeek(wk) {
    return Object.keys(allGPs[wk]?.cats || {}).sort();
  }

  /** Retourne le nom lisible d'un GP.
   *  Priorité : 1) allGPs[wk].name (saisi manuellement en DB)
   *             2) nom depuis une cat
   *             3) date formatée */
  function _gpName(wk) {
    if (allGPs[wk]?.name && typeof allGPs[wk].name === "string")
      return allGPs[wk].name;
    const cats = allGPs[wk]?.cats || {};
    for (const cat of Object.keys(cats)) {
      const n = cats[cat]?.name;
      if (n) return n;
    }
    return _fmtWeekDate(wk);
  }

  function _gpFlag(wk) {
    const gp = allGPs[wk];
    if (!gp || typeof gp !== "object") return "";
    return String(gp.flag || gp.nat || gp.country || gp.nationality || "")
      .trim()
      .toUpperCase();
  }

  function _fmtWeekDate(wk) {
    if (!wk) return "—";
    try {
      return new Date(wk).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch (e) {
      return wk;
    }
  }

  function _fmtWeekShort(wk) {
    if (!wk) return "—";
    try {
      return new Date(wk).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
      });
    } catch (e) {
      return wk;
    }
  }

  function _getSeasons() {
    const years = new Set(_sortedWeeks().map((wk) => wk.slice(0, 4)));
    return [...years].sort((a, b) => b - a);
  }

  function _getSeasonCats(year) {
    const catSet = new Set();
    _sortedWeeks()
      .filter((wk) => wk.startsWith(year))
      .forEach((wk) =>
        Object.keys(allGPs[wk]?.cats || {}).forEach((c) => catSet.add(c)),
      );
    return [...catSet].sort();
  }

  function _getSeasonGPs(year, cat) {
    return _sortedWeeks()
      .filter((wk) => wk.startsWith(year) && allGPs[wk]?.cats?.[cat])
      .reverse() // oldest first (chronological)
      .map((wk) => ({
        wk,
        name: _gpName(wk),
        races: allGPs[wk].cats[cat].races || {},
      }));
  }

  /** Numéro de round dans la saison (oldest = 1) */
  function _roundNumber(wk) {
    const year = wk.slice(0, 4);
    const yearWeeks = _sortedWeeks()
      .filter((w) => w.startsWith(year))
      .reverse();
    return yearWeeks.indexOf(wk) + 1;
  }

  /* ─────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────── */
  function init() {
    try {
      if (new URLSearchParams(location.search).get("mxontest") === "1") {
        _forceMxon = true;
        console.log(
          "[GP] MXoN TEST MODE enabled via ?mxontest=1 — remove the param (or run GP.testMxon(false) in the console) to go back to normal.",
        );
      }
    } catch (e) {}
    _buildPanel();
    _injectHeaderButton();
    _startRealtimeSync();
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) _close();
    });
  }

  /** Active/désactive le mode test MXoN à la volée depuis la console :
   *  GP.testMxon(true) puis rouvrir/rafraîchir le panneau GP. */
  function testMxon(on) {
    _forceMxon = !!on;
    _mxonTestSlots = {}; // repart propre à chaque activation/désactivation
    _mxonRealSeq = {};
    console.log(`[GP] MXoN test mode: ${_forceMxon ? "ON" : "OFF"}`);
    if (isOpen) _renderBody();
  }

  /* ─────────────────────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────────────────────── */
  function update(riders, meta) {
    latestRiders = riders || [];
    latestMeta = meta || null;

    if (meta && meta.category && meta.sessType) {
      cachedMeta = { ...meta };
    } else if (meta && cachedMeta) {
      latestMeta = { ...cachedMeta, ...meta };
    }

    if (latestMeta) {
      const normCat = _inferMetaCategory(latestMeta);
      if (normCat) latestMeta = { ...latestMeta, category: normCat };
      const sessKey = _inferSessionKey(latestMeta);
      if (sessKey) {
        const human =
          sessKey === "QR"
            ? "Qualifying Race"
            : sessKey === "R1"
              ? "Race 1"
              : "Race 2";
        if (latestMeta.sessType !== human) {
          latestMeta = { ...latestMeta, sessType: human };
          if (cachedMeta) cachedMeta = { ...cachedMeta, sessType: human };
        }
      }
    }

    _updateHeaderBtn();
    // Stats et Season utilisent uniquement les données Firebase (allGPs).
    // Les re-render depuis SignalR (~1/s) réinitialisaient le scroll en continu.
    if (isOpen && activeWeek !== "stats" && activeWeek !== "season")
      _renderBody();

    /* Écriture live événementielle.
       Navigateur normal : uniquement si le panel GP Standings est ouvert
       (comportement d'origine — pas la peine d'écrire si personne ne
       regarde l'onglet).
       Script headless (capture.js définit window.__MXGP_HEADLESS__ avant
       de charger gp.js) : TOUJOURS, puisque son unique rôle est
       justement d'alimenter Firebase sans qu'aucun onglet ne soit ouvert
       nulle part. */
    if (window.__MXGP_HEADLESS__) _scheduleLiveWrite();
  }

  function _liveSignature(cat, sessKey, riders) {
    /* Ne garde que les pilotes qui rapportent réellement des points,
       dans l'ordre du classement — un changement de cette séquence
       veut dire que le classement à points a réellement bougé. */
    const scored = riders.filter((r) => r.pts > 0).map((r) => r.nr);
    return `${cat}|${sessKey}|${scored.join(",")}`;
  }

  function _scheduleLiveWrite() {
    if (_liveDebounceTmr) return; // écriture déjà programmée, on laisse faire
    _liveDebounceTmr = setTimeout(() => {
      _liveDebounceTmr = null;
      _writeLive();
    }, LIVE_DEBOUNCE_MS);
  }

  function autoCapture(riders, meta) {
    /* Seul le script headless écrit désormais. Un navigateur classique
       ne doit plus rien tenter du tout (ni écriture, ni notification
       "AUTO-SAVE" trompeuse puisque rien n'est réellement sauvegardé).
       On retourne true ("traité") pour que main.js ne reboucle pas
       indéfiniment dessus. */
    if (!window.__MXGP_HEADLESS__) return true;
    /* Valeur de retour : true  = traité (sauvegardé, déjà existant, ou
                                    cas volontairement ignoré) → ne pas
                                    réessayer.
                          false = pas encore assez de données (ex:
                                    premier message reçu après connexion
                                    en plein milieu d'un "Finished", sans
                                    la liste des pilotes) → main.js DOIT
                                    réessayer au prochain message plutôt
                                    que de verrouiller sessionFinished. */
    if (!meta) return false;
    const key = _inferSessionKey(meta);
    if (!key) return false;
    const cat = _inferMetaCategory(meta);
    if (!cat) return false;

    /* FIM Motocross of Nations : la QR du samedi (3 courses séparées
       MXGP/MX2/Open) ne compte pas pour le classement des nations, et
       les 3 se disputeraient la même clé "QR" — on l'ignore entièrement. */
    if (cat === MXON_CAT && key === "QR") return true;

    const wk = _weekKey();
    if (allGPs[wk]?.cats?.[cat]?.races?.[key]) {
      console.log(
        `[GP] Auto-save skipped — ${cat} ${RACE_LABEL[key]} déjà enregistrée`,
      );
      return true;
    }

    const riderList = riders?.length ? riders : latestRiders;
    const filtered = riderList.filter((r) => r.pos && r.pos > 0);
    if (!filtered.length) {
      console.log(
        `[GP] Pas encore de données pilotes pour ${cat} ${RACE_LABEL[key] || key} — nouvelle tentative au prochain message`,
      );
      return false;
    }

    /* ── RED FLAG GUARD ──────────────────────────────────────────────
       If the leader has fewer than MIN_LAPS, this is almost certainly
       a red-flag stoppage, not a real finish. Skip auto-save and warn.
       The user can manually capture with ⬇ Capture once the re-started
       race is properly done.

       Math basis (max lap time = 2:30 = 150 s):
         R1 / R2 : 30 min ÷ 150 s = 12 laps + 2 extra = 14 real minimum
                   → guard at 12 (safety margin for fast tracks)
         QR      : 20 min ÷ 150 s =  8 laps + 2 extra = 10 real minimum
                   → guard at 8  (safety margin)

       Retourne false (pas true) : si la course reprend après le drapeau
       rouge et se termine ensuite pour de vrai avec assez de tours, on
       veut que la tentative automatique suivante puisse réussir toute
       seule — utile surtout côté script headless, où personne n'est là
       pour cliquer sur ⬇ Capture manuellement.
    ─────────────────────────────────────────────────────────────────── */
    const MIN_LAPS = key === "QR" ? 8 : 12;
    const maxLaps = Math.max(...filtered.map((r) => parseInt(r.laps) || 0), 0);
    if (maxLaps > 0 && maxLaps < MIN_LAPS) {
      console.warn(
        `[GP] Auto-save SKIPPED — red flag? only ${maxLaps} laps (min ${MIN_LAPS}) for ${cat} ${RACE_LABEL[key]}`,
      );
      _showNotif(
        `🚩 Red flag? Only ${maxLaps} lap${maxLaps > 1 ? "s" : ""} — auto-save skipped. Use ⬇ Capture after restart.`,
      );
      return false;
    }

    const results = filtered
      .sort((a, b) => a.pos - b.pos)
      .map((r, i) => ({
        pos: r.pos,
        nr: r.nr,
        fn: r.fn || "",
        ln: r.ln || "",
        bike: r.bike || "",
        nation: r.nation || "",
        pts: _ptsFor(cat, key, r.pos, i),
      }));

    const gpTitle = (meta.title || "").split(" - ")[0]?.trim() || "";
    const gpFlag =
      meta.flag ||
      meta.nat ||
      meta.nation ||
      meta.country ||
      meta.nationality ||
      "";
    const raceData = { ts: Date.now(), auto: true, cat, results };

    // Mise à jour locale optimiste
    if (!allGPs[wk]) allGPs[wk] = { cats: {}, live: null };
    /* FIX: Firebase SSE can replace the week node with {live:null} (no cats key),
       so we must guard before accessing allGPs[wk].cats[cat] */
    if (!allGPs[wk].cats) allGPs[wk].cats = {};
    if (!allGPs[wk].cats[cat]) allGPs[wk].cats[cat] = { name: "", races: {} };
    if (gpTitle && !allGPs[wk].cats[cat].name)
      allGPs[wk].cats[cat].name = gpTitle;
    allGPs[wk].cats[cat].races[key] = raceData;

    if (gpFlag && !allGPs[wk].flag) allGPs[wk].flag = gpFlag;
    _writeRace(cat, key, raceData, gpTitle, gpFlag);

    // Effacer le nœud live
    fetch(`${_wkBase(wk)}/live.json`, { method: "DELETE" }).catch(
      () => {},
    );
    if (allGPs[wk]) allGPs[wk].live = null;

    // Reset détection de changement — repart propre pour la prochaine session
    _liveLastSig = null;
    _liveLastWriteTs = 0;
    if (_liveDebounceTmr) {
      clearTimeout(_liveDebounceTmr);
      _liveDebounceTmr = null;
    }

    activeWeek = wk;
    activeCat = cat;
    activeTab = key;

    console.log(
      `[GP] ✅ SAVED — ${cat} ${RACE_LABEL[key]} — ${results.length} riders`,
    );
    _showNotif(
      `✔ AUTO-SAVE  ${cat} · ${RACE_LABEL[key]}  —  ${results.length} riders`,
    );
    _updateHeaderBtn();
    if (isOpen) _renderBody();
    return true;
  }

  function setCurrent(cat, sess) {
    currentCat = cat || "";
    currentSess = sess || "";
  }

  /* ─────────────────────────────────────────────────────────
     BUILD PANEL
  ───────────────────────────────────────────────────────── */
  function _buildPanel() {
    panel = document.createElement("div");
    panel.id = "gp-panel";
    panel.className = "gp-panel";
    panel.innerHTML = `
      <div class="gp-topbar">
        <div class="gp-topbar-left">
          <span class="gp-topbar-icon">🏆</span>
          <span class="gp-topbar-title">GP STANDINGS</span>
        </div>
        <div class="gp-topbar-right">
          <span class="gp-sync-indicator" id="gp-sync" title="Firebase sync">●</span>
          <button class="gp-capture-btn" id="gp-capture-btn" hidden title="Capture current session results">⬇</button>
          <button class="gp-close" id="gp-close" title="Close (Esc)">✕</button>
        </div>
      </div>

      <div class="gp-layout">
        <!-- ── Sidebar : liste des GPs ── -->
        <div class="gp-sidebar" id="gp-sidebar"></div>

        <!-- ── Zone principale ── -->
        <div class="gp-main">
          <div class="gp-cat-bar"  id="gp-cat-bar"></div>
          <div class="gp-tabs-bar" id="gp-tabs-bar">
            <div class="gp-tabs" id="gp-tabs"></div>
          </div>
          <div class="gp-body" id="gp-body"></div>
        </div>
      </div>

      <div class="gp-toast" id="gp-toast"></div>
    `;
    document.body.appendChild(panel);

    document.getElementById("gp-close").addEventListener("click", _close);
    document
      .getElementById("gp-capture-btn")
      .addEventListener("click", _capture);
    _updateSyncIndicator(false);
  }

  /* ─────────────────────────────────────────────────────────
     BOUTON HEADER
  ───────────────────────────────────────────────────────── */
  function _injectHeaderButton() {
    const btn = document.createElement("button");
    btn.id = "gp-hdr-btn";
    btn.className = "gp-hdr-btn";
    btn.title = "GP Standings";
    btn.innerHTML =
      '<span class="gp-hdr-icon">🏆</span>' +
      '<span class="gp-hdr-lbl">GP</span>' +
      '<span class="gp-hdr-dot"></span>';
    btn.addEventListener("click", () => (isOpen ? _close() : _open()));

    const target = document.querySelector(".hdr-right");
    if (target) target.insertBefore(btn, target.firstChild);
    else document.querySelector(".hdr-inner")?.appendChild(btn);
  }

  function _updateHeaderBtn() {
    const btn = document.getElementById("gp-hdr-btn");
    if (!btn) return;
    const hasData = Object.values(allGPs).some(
      (gp) =>
        gp &&
        Object.values(gp.cats || {}).some(
          (c) => c && Object.keys(c.races || {}).length > 0,
        ),
    );
    btn.classList.toggle("has-data", hasData);
    btn.classList.toggle("gp-btn-active", isOpen);
  }

  /* ─────────────────────────────────────────────────────────
     OPEN / CLOSE
  ───────────────────────────────────────────────────────── */
  function _open() {
    isOpen = true;
    panel.classList.add("gp-visible");
    if (!_sseConn) _startRealtimeSync();

    // Sélection initiale : semaine live si disponible, sinon la plus récente
    if (!activeWeek) {
      const wk = _weekKey();
      const weeks = _sortedWeeks();
      const liveCat = _inferMetaCategory(latestMeta || cachedMeta);
      activeWeek = liveCat || allGPs[wk] ? wk : weeks[0] || wk;
    }

    // Sélection initiale de catégorie
    if (!activeCat && activeWeek !== "season") {
      const liveCat = _inferMetaCategory(latestMeta || cachedMeta);
      activeCat = liveCat || _sortedCatsForWeek(activeWeek)[0] || "";
    }

    _renderBody();
    _startLiveLoop();

    // Scroll lock mobile-safe (iOS fix : position:fixed + top:-scrollY)
    const sy = Math.round(window.scrollY);
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${sy}px`;
    document.body.style.width = "100%";
    document._gpScrollY = sy;
  }

  function _close() {
    isOpen = false;
    panel.classList.remove("gp-visible");
    _stopLiveLoop();
    _stopLiveAgeRefresh();
    _stopRealtimeSync();

    // Restaurer le scroll body
    const sy = document._gpScrollY ?? 0;
    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.width = "";
    delete document._gpScrollY;
    window.scrollTo(0, sy);
  }

  function _startLiveLoop() {
    _stopLiveLoop();
    _writeLive();
    _liveTimer = setInterval(_writeLive, LIVE_THROTTLE_MS);
  }

  function _stopLiveLoop() {
    if (_liveTimer) {
      clearInterval(_liveTimer);
      _liveTimer = null;
    }
  }

  /* ─────────────────────────────────────────────────────────
     RENDER — dispatcher
  ───────────────────────────────────────────────────────── */
  function _renderBody() {
    _renderSidebar();

    if (activeWeek === "season") {
      _renderSeasonView();
    } else if (activeWeek === "stats") {
      const captureBtn = document.getElementById("gp-capture-btn");
      if (captureBtn) captureBtn.hidden = true;
      const tabs = document.getElementById("gp-tabs");
      if (tabs) tabs.innerHTML = "";

      // Throttle + Scroll preservation pour stats
      if (_statsRenderTimer) return;

      _statsRenderTimer = setTimeout(() => {
        _statsRenderTimer = null;
        _withScrollPreservation(() => {
          Stats.render(document.getElementById("gp-body"), {
            allGPs,
            getActiveSeason: () => activeSeason,
            setActiveSeason: (v) => {
              activeSeason = v;
            },
            getActiveCat: () => activeCat,
            getSeasons: _getSeasons,
            renderSeasonCatBar: _renderSeasonCatBar,
            renderBody: _renderBody,
            sortedWeeks: _sortedWeeks,
            esc: _esc,
          });
        });
      }, 100);
    } else {
      _renderWeekView();
    }
  }

  /* ─────────────────────────────────────────────────────────
     SIDEBAR
  ───────────────────────────────────────────────────────── */
  function _renderSidebar() {
    const sb = document.getElementById("gp-sidebar");
    if (!sb) return;
    sb.innerHTML = "";

    const weeks = _sortedWeeks();
    const seasons = _getSeasons();

    // ── Bouton SAISON ──
    if (weeks.length > 0) {
      const seasonBtn = document.createElement("button");
      seasonBtn.className =
        "gp-sb-season" + (activeWeek === "season" ? " gp-sb-active" : "");
      seasonBtn.innerHTML = `<span class="gp-sb-season-icon">🌍</span><span class="gp-sb-season-lbl">SEASON</span>`;
      seasonBtn.title = "Cumulative season standings";
      seasonBtn.addEventListener("click", () => {
        activeWeek = "season";
        if (!activeSeason || !seasons.includes(activeSeason))
          activeSeason = seasons[0];
        const cats = _getSeasonCats(activeSeason);
        if (!cats.includes(activeCat)) activeCat = cats[0] || "";
        _renderBody();
      });
      sb.appendChild(seasonBtn);

      // Stats button
      const statsBtn = document.createElement("button");
      statsBtn.className =
        "gp-sb-stats" + (activeWeek === "stats" ? " gp-sb-active" : "");
      statsBtn.innerHTML = `<span>📊</span><span class="gp-sb-season-lbl">STATS</span>`;
      statsBtn.title = "Statistics";
      statsBtn.addEventListener("click", () => {
        activeWeek = "stats";
        if (!activeSeason) activeSeason = _getSeasons()[0];
        const cats = _getSeasonCats(activeSeason);
        if (!cats.includes(activeCat)) activeCat = cats[0] || "";
        Stats.resetSort();
        _renderBody();
      });
      sb.appendChild(statsBtn);

      const div = document.createElement("div");
      div.className = "gp-sb-divider";
      sb.appendChild(div);
    }

    // ── Entrée par GP ──
    const currentWk = _weekKey();

    weeks.forEach((wk) => {
      const gpCats = allGPs[wk]?.cats || {};
      const hasLive = !!allGPs[wk]?.live;
      const isCurrentWk = wk === currentWk;
      const hasAnyData = Object.values(gpCats).some(
        (c) => c && Object.keys(c.races || {}).length > 0,
      );
      const isLiveNow = isCurrentWk && !!(latestMeta || cachedMeta);
      const catKeys = Object.keys(gpCats);
      const rdNum = _roundNumber(wk);
      const name = _gpName(wk);
      const gpFlag = _gpFlag(wk);

      const entry = document.createElement("button");
      entry.className =
        "gp-sb-entry" +
        (activeWeek === wk ? " gp-sb-active" : "") +
        (isCurrentWk ? " gp-sb-current" : "");

      // Nom court : enlever le préfixe de catégorie du nom GP
      const shortName =
        name
          .replace(/^(MXGP|MX2|WMX)\s*(de|du|des|d'|of|di|de la|del)?\s*/i, "")
          .trim() || name;

      const liveBadge =
        isCurrentWk && (isLiveNow || hasLive)
          ? `<span class="gp-sb-live">LIVE</span>`
          : "";

      const catDots = catKeys.length
        ? `<div class="gp-sb-cats">${catKeys
            .map((c) => {
              const cc = _catColor(c);
              return `<span class="gp-sb-cat" style="--cat-c:${cc};color:#fff;background:${cc}22;border-color:${cc}55">${c}</span>`;
            })
            .join("")}</div>`
        : "";

      entry.innerHTML = `
        <div class="gp-sb-top">
          <span class="gp-sb-round">Rd ${rdNum}</span>
          ${liveBadge}
        </div>
        <div class="gp-sb-name">${_esc(shortName)}</div>
        <div class="gp-sb-date">${_fmtWeekShort(wk)}</div>
        ${catDots}
      `;

      if (gpFlag) {
        const nameDiv = entry.querySelector(".gp-sb-name");
        if (nameDiv) {
          const flagNode =
            typeof getNatFlag === "function" ? getNatFlag(gpFlag) : null;
          if (flagNode) {
            nameDiv.textContent = "";
            const wrapper = document.createElement("span");
            wrapper.className = "gp-sb-name-flag";
            wrapper.appendChild(flagNode);
            const textSpan = document.createElement("span");
            textSpan.className = "gp-sb-name-text";
            textSpan.textContent = shortName;
            wrapper.appendChild(textSpan);
            nameDiv.appendChild(wrapper);
          }
        }
      }

      entry.addEventListener("click", () => {
        activeWeek = wk;
        activeTab = "GP";
        const wkCats = _sortedCatsForWeek(wk);
        const liveCat = isCurrentWk
          ? _inferMetaCategory(latestMeta || cachedMeta)
          : "";
        if (!wkCats.includes(activeCat)) {
          activeCat =
            isCurrentWk && liveCat ? liveCat : wkCats[0] || liveCat || "";
        }
        _renderBody();
      });

      sb.appendChild(entry);
    });

    if (weeks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gp-sb-empty";
      empty.textContent = "No GP recorded";
      sb.appendChild(empty);
    }
  }

  /* ─────────────────────────────────────────────────────────
     SCROLL PRESERVATION
  ───────────────────────────────────────────────────────── */
  function _withScrollPreservation(fn) {
    const body = document.getElementById("gp-body");
    // Lire avant fn() — l'élément est encore dans le DOM.
    // IMPORTANT : querySelectorAll (pas querySelector) — une vue peut
    // afficher plusieurs tables scrollables en même temps (plusieurs
    // manches listées) ; avant, seule la toute première conservait son
    // scroll horizontal, les suivantes sautaient à chaque actualisation.
    const wraps = body ? [...body.querySelectorAll(".gp-table-wrap")] : [];
    const savedLefts = wraps.map((w) => w.scrollLeft);
    const savedTop = body?.scrollTop ?? 0;

    fn();

    // body n'est pas remplacé par innerHTML → scrollTop direct OK
    if (body) body.scrollTop = savedTop;

    // Les .gp-table-wrap peuvent avoir été recréés — requête fraîche
    // dans double RAF (1er RAF = après mutation DOM, 2ème = après
    // premier paint). On réapplique par position (même ordre de rendu
    // attendu entre deux passes tant que la liste de manches ne change
    // pas), à TOUTES les tables, pas juste la première.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (body) body.scrollTop = savedTop;
        const newWraps = body ? [...body.querySelectorAll(".gp-table-wrap")] : [];
        newWraps.forEach((w, i) => {
          if (savedLefts[i] > 0) w.scrollLeft = savedLefts[i];
        });
      });
    });
  }

  /* ─────────────────────────────────────────────────────────
     WEEK VIEW
  ───────────────────────────────────────────────────────── */
  function _renderWeekView() {
    const wk = activeWeek || _weekKey();
    const isCurrentWk = wk === _weekKey();
    const captureBtn = document.getElementById("gp-capture-btn");
    const body = document.getElementById("gp-body");

    // Bouton capture : visible seulement pour la semaine courante
    if (captureBtn) captureBtn.hidden = !isCurrentWk;

    // Sauvegarder scroll AVANT mise à jour
    _withScrollPreservation(() => {
      _renderCatBar(wk, isCurrentWk);
      _renderTabs(wk, isCurrentWk);

      if (!activeCat) {
        body.innerHTML = `<div class="gp-empty">No data for this GP.</div>`;
      } else if (activeTab === "GP") {
        _renderGP(body, wk, isCurrentWk);
      } else {
        _renderRace(body, wk, activeTab, isCurrentWk);
      }
    });
  }

  /* ─────────────────────────────────────────────────────────
     CAT BAR
  ───────────────────────────────────────────────────────── */
  function _renderCatBar(wk, isCurrentWk) {
    const bar = document.getElementById("gp-cat-bar");
    if (!bar) return;
    bar.innerHTML = "";

    const liveCat = isCurrentWk
      ? _inferMetaCategory(latestMeta || cachedMeta)
      : "";
    const gpCats = allGPs[wk]?.cats || {};
    const allSet = new Set(Object.keys(gpCats));
    if (isCurrentWk && liveCat) allSet.add(liveCat);
    const cats = [...allSet].sort();

    if (!cats.length) return;

    // Auto-sélection
    if (!activeCat || !allSet.has(activeCat)) {
      activeCat = isCurrentWk && liveCat ? liveCat : cats[0] || "";
    }

    cats.forEach((cat) => {
      const hasData = !!(
        gpCats[cat] && Object.keys(gpCats[cat].races || {}).length
      );
      const isLive = isCurrentWk && cat === liveCat;
      const catC = _catColor(cat);

      const btn = document.createElement("button");
      btn.className =
        "gp-cat-btn" +
        (cat === activeCat ? " gp-cat-active" : "") +
        (hasData ? " gp-cat-has" : "");
      btn.style.setProperty("--cat-c", catC);
      btn.innerHTML =
        _esc(cat) +
        (isLive && !hasData ? " ▶" : "") +
        (hasData ? '<span class="gp-cat-dot"></span>' : "");
      btn.addEventListener("click", () => {
        activeCat = cat;
        activeTab = "GP";
        _renderBody();
      });
      bar.appendChild(btn);
    });
  }

  /* ─────────────────────────────────────────────────────────
     TABS
  ───────────────────────────────────────────────────────── */
  function _renderTabs(wk, isCurrentWk) {
    const tabs = document.getElementById("gp-tabs");
    if (!tabs) return;
    tabs.innerHTML = "";

    const catD = allGPs[wk]?.cats?.[activeCat];
    const races = catD?.races || {};
    const liveMeta = isCurrentWk ? latestMeta || cachedMeta : null;
    const liveKey = liveMeta ? _inferSessionKey(liveMeta) : null;
    const liveCat = liveMeta ? _inferMetaCategory(liveMeta) : null;
    const isLiveCat = isCurrentWk && liveCat === activeCat;

    const keysSet = new Set(Object.keys(races));
    if (isLiveCat && liveKey) keysSet.add(liveKey);

    const showGP = keysSet.size > 0;
    const allKeys = [...keysSet].sort(
      (a, b) => RACE_ORDER.indexOf(a) - RACE_ORDER.indexOf(b),
    );
    const toRender = showGP ? ["GP", ...allKeys] : allKeys;
    if (!toRender.length) return;

    toRender.forEach((key) => {
      const hasData =
        key === "GP"
          ? !!(races.R1 || races.R2 || races.R3 || races.QR)
          : !!races[key];
      const isLive = key !== "GP" && isLiveCat && key === liveKey && !hasData;
      const isAuto = hasData && key !== "GP" && races[key]?.auto;

      const label =
        key === "GP"
          ? activeCat === MXON_CAT
            ? "🏆 Nations"
            : "🏁 Standings"
          : (RACE_LABEL[key] || key) + (isLive ? " ▶" : "");

      const btn = document.createElement("button");
      btn.className =
        "gp-tab" +
        (activeTab === key ? " gp-tab-active" : "") +
        (hasData ? " gp-tab-has" : "") +
        (isAuto ? " gp-tab-auto" : "");
      btn.textContent = label;
      btn.addEventListener("click", () => {
        activeTab = key;
        _renderBody();
      });
      tabs.appendChild(btn);
    });
  }

  /* ─────────────────────────────────────────────────────────
     GP OVERALL (week view)
  ───────────────────────────────────────────────────────── */
  function _renderGP(body, wk, isCurrentWk) {
    if (activeCat === MXON_CAT)
      return _renderMxonStandings(body, wk, isCurrentWk);

    const catD = allGPs[wk]?.cats?.[activeCat];
    const races = catD?.races || {};

    const liveD = isCurrentWk ? allGPs[wk]?.live : null;
    const liveMeta = isCurrentWk ? latestMeta || cachedMeta : null;
    const liveKey = liveMeta ? _inferSessionKey(liveMeta) : null;
    const liveCat = liveMeta ? _inferMetaCategory(liveMeta) : null;

    const hasLiveFB =
      liveD &&
      _normalizeCat(liveD.cat) === activeCat &&
      liveD.sessKey &&
      !races[liveD.sessKey];
    const hasLiveLocal =
      isCurrentWk &&
      liveKey &&
      liveCat === activeCat &&
      latestRiders.length &&
      !races[liveKey];
    const hasAnyLive = hasLiveFB || hasLiveLocal;

    const rows = _computeStandingsWeek(wk, hasAnyLive, isCurrentWk);

    const hasQR = rows.some((r) => r.QR);
    const hasR1 = rows.some((r) => r.R1);
    const hasR2 = rows.some((r) => r.R2);
    const hasTotal = hasR1 || hasR2;
    const hasTotalAll = hasQR && hasTotal;
    const name = catD?.name || activeCat;

    const liveRaceKey = hasLiveFB
      ? liveD.sessKey
      : hasLiveLocal
        ? liveKey
        : null;
    const liveLabel = liveRaceKey
      ? RACE_LABEL[liveRaceKey] || liveRaceKey
      : null;

    let html = `<div class="gp-gp-header">
      <div class="gp-gp-name">${name && name !== activeCat ? _esc(name) + " · " + _esc(activeCat) : _esc(activeCat)}${
        hasAnyLive
          ? ` <span class="gp-live-badge">🔴 LIVE — ${_esc(liveLabel || "")}</span>`
          : ""
      }</div>
    </div>`;

    if (!rows.length) {
      if (hasAnyLive) {
        html += hasLiveFB
          ? _liveFirebaseTable(liveD.sessKey, liveD)
          : _previewTable(liveKey, activeCat);
      } else {
        html += `<div class="gp-empty">No race recorded for ${_esc(activeCat)}.</div>`;
      }
      body.innerHTML = html;
      return;
    }

    const leaderTotal = rows[0]?.total || 0;
    const leaderTotalAll = rows[0]?.totalAll || 0;

    html += `<div class="gp-table-wrap"><table class="gp-table"><thead><tr>
      <th>#</th><th>Rider</th><th class="gp-th-bike">Bike</th>
      ${hasQR ? '<th title="Qualifying Race">QR</th>' : ""}
      ${hasR1 ? "<th>R1</th>" : ""}
      ${hasR2 ? "<th>R2</th>" : ""}
      ${hasTotal ? '<th class="gp-col-total">Total GP</th>' : ""}
      ${hasTotalAll ? '<th class="gp-col-total">Total</th>' : ""}
      ${hasTotalAll || (hasTotal && !hasTotalAll) ? '<th class="gp-col-diff">Gap</th>' : ""}
    </tr></thead><tbody>`;

    rows.forEach((r, idx) => {
      const gpPos = idx + 1;
      const posCls = gpPos <= 3 ? `gp-pos-${gpPos}` : "";
      const refT = hasTotalAll ? r.totalAll : r.total;
      const refL = hasTotalAll ? leaderTotalAll : leaderTotal;
      const diffPts = idx === 0 ? null : refL - refT;
      const diffStr = idx === 0 ? "—" : diffPts !== null ? `-${diffPts}` : "—";
      const diffCls =
        idx === 0
          ? "gp-diff-leader"
          : diffPts !== null && diffPts <= 5
            ? "gp-diff-close"
            : "";

      html += `<tr class="${posCls}">
        <td class="gp-td-pos">${gpPos}</td>
        <td class="gp-td-name">
          <span class="gp-fn">${_esc(r.fn)}</span>
          <span class="gp-ln">${_esc(r.ln)}</span>
          <span class="gp-nr">#${r.nr}</span>
        </td>
        <td class="gp-td-bike gp-th-bike">${_esc(r.bike)}</td>
        ${
          hasQR
            ? `<td class="gp-td-qr">${
                r.QR
                  ? `<span class="gp-pts-qr">${r.QR.pts}</span><span class="gp-racepos">(${r.QR.pos})</span>`
                  : `<span class="gp-pts-qr">0</span>`
              }</td>`
            : ""
        }
        ${
          hasR1
            ? `<td>${
                r.R1
                  ? `<span class="gp-pts">${r.R1.pts}</span><span class="gp-racepos">(${r.R1.pos})</span>`
                  : `<span class="gp-pts">0</span>`
              }</td>`
            : ""
        }
        ${
          hasR2
            ? `<td>${
                r.R2
                  ? `<span class="gp-pts">${r.R2.pts}</span><span class="gp-racepos">(${r.R2.pos})</span>`
                  : `<span class="gp-pts">0</span>`
              }</td>`
            : ""
        }
        ${hasTotal ? `<td class="gp-td-total">${r.total}</td>` : ""}
        ${hasTotalAll ? `<td class="gp-td-total gp-td-total-all">${r.totalAll}</td>` : ""}
        ${hasTotalAll || (hasTotal && !hasTotalAll) ? `<td class="gp-td-diff ${diffCls}">${diffStr}</td>` : ""}
      </tr>`;
    });

    html += `</tbody></table></div>`;
    body.innerHTML = html;
  }

  function _computeStandingsWeek(wk, includeLive, isCurrentWk) {
    const catD = allGPs[wk]?.cats?.[activeCat];
    const map = {};

    function _add(nr, fn, ln, bike, key, pos, pts) {
      if (!map[nr])
        map[nr] = { fn, ln, bike, nr, QR: null, R1: null, R2: null };
      map[nr][key] = { pos, pts };
    }

    if (catD) {
      RACE_ORDER.forEach((key) => {
        const race = catD.races[key];
        if (!race) return;
        race.results.forEach((r) =>
          _add(r.nr, r.fn, r.ln, r.bike, key, r.pos, r.pts),
        );
      });
    }

    if (includeLive && isCurrentWk) {
      const liveD = allGPs[wk]?.live;
      if (liveD) {
        if (
          _normalizeCat(liveD.cat) === activeCat &&
          liveD.sessKey &&
          !catD?.races?.[liveD.sessKey]
        ) {
          (liveD.riders || []).forEach((r) =>
            _add(r.nr, r.fn, r.ln, r.bike, liveD.sessKey, r.pos, r.pts),
          );
        }
      }
      if (latestRiders.length) {
        const lm = latestMeta || cachedMeta;
        const liveKey = _inferSessionKey(lm);
        const liveC = _inferMetaCategory(lm);
        if (
          liveKey &&
          liveC === activeCat &&
          !catD?.races?.[liveKey] &&
          !allGPs[wk]?.live
        ) {
          const scale = liveKey === "QR" ? PTS_QR : PTS_RACE;
          [...latestRiders]
            .filter((r) => r.pos && r.pos > 0)
            .sort((a, b) => a.pos - b.pos)
            .forEach((r, i) =>
              _add(
                r.nr,
                r.fn || "",
                r.ln || "",
                r.bike || "",
                liveKey,
                r.pos,
                scale[i] || 0,
              ),
            );
        }
      }
    }

    if (!Object.keys(map).length) return [];

    return Object.values(map)
      .map((d) => ({
        ...d,
        total: (d.R1?.pts || 0) + (d.R2?.pts || 0),
        totalAll: (d.QR?.pts || 0) + (d.R1?.pts || 0) + (d.R2?.pts || 0),
      }))
      .sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return (a.R2?.pos || 99) - (b.R2?.pos || 99);
      });
  }

  /* ─────────────────────────────────────────────────────────
     FIM MOTOCROSS OF NATIONS — CLASSEMENT PAR NATION
     Regroupe les résultats individuels (déjà capturés + la course en
     cours si elle appartient à ce week-end) par colonne "nation" du
     pilote, puis applique : total = somme des points - le plus mauvais
     résultat (dès que ≥2 résultats sont connus pour cette nation).
     C'est équivalent à la règle officielle "5 meilleurs sur 6" une fois
     que les 3 courses (6 résultats) sont terminées, et donne un
     classement qui évolue en direct pendant le week-end.
  ───────────────────────────────────────────────────────── */
  const MXON_RACE_ORDER = ["R1", "R2", "R3"];

  function _computeMxonStandings(wk, isCurrentWk) {
    const catD = allGPs[wk]?.cats?.[MXON_CAT];
    const races = catD?.races || {};
    const nations = {}; // code → { nat, results:[{race,pos,pts,nr,fn,ln,bike}] }
    let liveKeyUsed = null;

    function _add(key, r) {
      const nat =
        String(r.nation || "")
          .toUpperCase()
          .trim() || "—";
      if (!nations[nat]) nations[nat] = { nat, results: [] };
      nations[nat].results.push({
        race: key,
        pos: r.pos,
        pts: r.pts,
        nr: r.nr,
        fn: r.fn || "",
        ln: r.ln || "",
        bike: r.bike || "",
      });
    }

    MXON_RACE_ORDER.forEach((key) => {
      const race = races[key];
      if (race) {
        race.results.forEach((r) => _add(key, r));
        return;
      }

      /* Course pas encore capturée → si c'est LA course en cours de ce
         week-end, on utilise les positions live (mise à jour à chaque
         tick de GP.update) pour un classement qui bouge en temps réel. */
      if (!isCurrentWk) return;

      const liveD = allGPs[wk]?.live;
      if (
        liveD &&
        _normalizeCat(liveD.cat) === MXON_CAT &&
        liveD.sessKey === key &&
        liveD.riders?.length
      ) {
        liveKeyUsed = key;
        liveD.riders.forEach((r) => _add(key, r));
        return;
      }

      if (latestRiders.length) {
        const lm = latestMeta || cachedMeta;
        const liveKey = _inferSessionKey(lm);
        const liveCat = _inferMetaCategory(lm);
        if (liveKey === key && liveCat === MXON_CAT) {
          liveKeyUsed = key;
          [...latestRiders]
            .filter((r) => r.pos && r.pos > 0)
            .forEach((r) =>
              _add(key, {
                pos: r.pos,
                pts: r.pos,
                nr: r.nr,
                fn: r.fn || "",
                ln: r.ln || "",
                bike: r.bike || "",
                nation: r.nation || "",
              }),
            );
        }
      }
    });

    /* Une nation ne peut compter que 2 pilotes par course (structure
       réelle du MXoN : 2 classes combinées = 2 pilotes de l'équipe).
       - S'il y en a plus de 2 (grille de test "normale", plusieurs
         pilotes d'un même pays présents par hasard) → on ne garde que
         les 2 meilleurs de cette course pour cette nation.
       - S'il n'y en a qu'1 seul → non comptabilisé pour cette course
         (au vrai MXoN les 2 pilotes de la course sont toujours présents,
         donc ce cas ne devrait jamais arriver en réalité). */
    Object.values(nations).forEach((n) => {
      const byRace = {};
      n.results.forEach((r) => {
        (byRace[r.race] || (byRace[r.race] = [])).push(r);
      });
      const capped = [];
      Object.values(byRace).forEach((arr) => {
        if (arr.length < 2) return;
        arr.sort((a, b) => a.pts - b.pts); // meilleur (petit) d'abord
        capped.push(arr[0], arr[1]);
      });
      n.results = capped;
    });

    const rows = Object.values(nations)
      .filter((n) => n.results.length)
      .map((n) => {
        const sorted = [...n.results].sort((a, b) => a.pts - b.pts); // meilleur (petit) d'abord
        const worst = sorted.length >= 2 ? sorted[sorted.length - 1] : null;
        const total = sorted.reduce((s, r) => s + (r === worst ? 0 : r.pts), 0);
        return { ...n, results: sorted, worst, total, count: sorted.length };
      });

    rows.sort((a, b) => {
      if (a.total !== b.total) return a.total - b.total; // moins de points = mieux
      if (b.count !== a.count) return b.count - a.count; // + de résultats connus = devant en cas d'égalité
      const bestA = Math.min(...a.results.map((r) => r.pts));
      const bestB = Math.min(...b.results.map((r) => r.pts));
      return bestA - bestB;
    });

    return { rows, liveKeyUsed };
  }

  function _renderMxonStandings(body, wk, isCurrentWk) {
    const catD = allGPs[wk]?.cats?.[MXON_CAT];
    const { rows, liveKeyUsed } = _computeMxonStandings(wk, isCurrentWk);
    const name = catD?.name || "FIM Motocross of Nations";

    const liveBadge = liveKeyUsed
      ? ` <span class="gp-live-badge">🔴 LIVE — ${_esc(RACE_LABEL[liveKeyUsed] || liveKeyUsed)}</span>`
      : "";

    let html = `<div class="gp-gp-header">
      <div class="gp-gp-name">🏆 ${_esc(name)}${liveBadge}</div>
    </div>`;

    if (!rows.length) {
      html += `<div class="gp-empty">No FIM Motocross of Nations result yet.</div>`;
      body.innerHTML = html;
      return;
    }

    html += `<div class="gp-mxon-note">Nations classification — best 5 of 6 individual results (worst dropped), points = finishing position, irrespective of class.</div>`;

    html += `<div class="gp-stats-table-wrap"><table class="gp-stats-table gp-mxon-table"><thead><tr>
      <th>#</th><th>Nation</th>
      <th title="Race 1 — MXGP + MX2">R1</th>
      <th title="Race 2 — MX2 + Open">R2</th>
      <th title="Race 3 — MXGP + Open">R3</th>
      <th>Total</th>
    </tr></thead><tbody>`;

    rows.forEach((n, idx) => {
      const pos = idx + 1;
      const posCls = pos <= 3 ? `gp-pos-${pos}` : "";

      const raceCell = (key) => {
        const items = n.results.filter((r) => r.race === key);
        if (!items.length) return '<span class="gp-mxon-empty">—</span>';
        return items
          .map((r) => {
            const dropped = r === n.worst;
            return `<span class="gp-mxon-res${dropped ? " gp-mxon-drop" : ""}" title="${_esc(r.fn + " " + r.ln)} · #${_esc(r.nr)} · P${r.pos}${dropped ? " (dropped)" : ""}">${r.pts}</span>`;
          })
          .join("");
      };

      html += `<tr class="${posCls}">
        <td>${pos}</td>
        <td>
          <span class="gp-mxon-nation">${_natCell(n.nat)}<span class="gp-nat-code">${_esc(n.nat)}</span><span class="gp-mxon-count">${n.count}/6</span></span>
        </td>
        <td class="gp-mxon-cell">${raceCell("R1")}</td>
        <td class="gp-mxon-cell">${raceCell("R2")}</td>
        <td class="gp-mxon-cell">${raceCell("R3")}</td>
        <td class="gp-td-total">${n.total}</td>
      </tr>`;
    });

    html += `</tbody></table></div>`;
    body.innerHTML = html;
  }

  /* ─────────────────────────────────────────────────────────
     RACE VIEW (week view)
  ───────────────────────────────────────────────────────── */
  function _renderRace(body, wk, key, isCurrentWk) {
    const catD = allGPs[wk]?.cats?.[activeCat];
    const race = catD?.races?.[key];
    const isMxon = activeCat === MXON_CAT;
    _stopLiveAgeRefresh();

    if (!race) {
      if (isCurrentWk) {
        const liveD = allGPs[wk]?.live;
        if (
          liveD &&
          _normalizeCat(liveD.cat) === activeCat &&
          liveD.sessKey === key &&
          liveD.riders?.length
        ) {
          body.innerHTML = _liveFirebaseTable(key, liveD);
          _startLiveAgeRefresh(liveD.ts);
          return;
        }
        const liveSessKey = _inferSessionKey(latestMeta || cachedMeta);
        const liveC = _inferMetaCategory(latestMeta || cachedMeta);
        if (liveSessKey === key && liveC === activeCat && latestRiders.length) {
          body.innerHTML = _previewTable(key, activeCat);
          return;
        }
      }
      body.innerHTML = `<div class="gp-empty">${RACE_LABEL[key] || key} ${_esc(activeCat)} — aucun résultat.</div>`;
      return;
    }

    /* Indicateur discret : cette branche de rendu n'est atteinte QUE
       quand `race` vient réellement de allGPs (donc de Firebase, donc
       persisté) — jamais pour un aperçu live temporaire (voir
       _previewTable, qui affiche "🔴 LIVE" séparément). On l'affiche
       donc systématiquement ici, avec un libellé qui précise en plus
       si c'était une sauvegarde automatique. */
    const autoLabel = `<span class="gp-race-auto" title="${
      race.auto
        ? "Sauvegardé automatiquement en base de données"
        : "Sauvegardé en base de données"
    }">💾 ${race.auto ? "AUTO-SAVED" : "SAVED"}</span>`;

    let html = `<div class="gp-race-header">
      <span class="gp-race-label">${RACE_LABEL[key]}</span>
      <span class="gp-race-cat">${_esc(race.cat || activeCat)}</span>
      ${autoLabel}
      <span class="gp-race-ts">${_fmtDate(race.ts)}</span>
    </div>`;

    html += `<div class="gp-table-wrap"><table class="gp-table"><thead><tr>
      <th>Pos</th><th>Rider</th><th class="gp-th-bike">Bike</th>
      ${isMxon ? "<th>Nat</th>" : ""}
      <th>Points</th>
    </tr></thead><tbody>`;

    race.results.forEach((r) => {
      const posCls = r.pos <= 3 ? `gp-pos-${r.pos}` : "";
      html += `<tr class="${posCls}">
        <td class="gp-td-pos">${r.pos}</td>
        <td class="gp-td-name">
          <span class="gp-fn">${_esc(r.fn)}</span>
          <span class="gp-ln">${_esc(r.ln)}</span>
          <span class="gp-nr">#${r.nr}</span>
        </td>
        <td class="gp-td-bike gp-th-bike">${_esc(r.bike)}</td>
        ${isMxon ? `<td class="gp-td-nat">${_natCell(r.nation)}</td>` : ""}
        <td class="gp-td-ptsrace">${r.pts}</td>
      </tr>`;
    });

    html += `</tbody></table></div>`;
    body.innerHTML = html;
  }

  /* ─────────────────────────────────────────────────────────
     SEASON VIEW
  ───────────────────────────────────────────────────────── */
  function _renderSeasonView() {
    const captureBtn = document.getElementById("gp-capture-btn");
    if (captureBtn) captureBtn.hidden = true;
    const tabs = document.getElementById("gp-tabs");
    const body = document.getElementById("gp-body");
    if (tabs) tabs.innerHTML = "";

    const seasons = _getSeasons();
    if (!activeSeason || !seasons.includes(activeSeason))
      activeSeason = seasons[0] || "";

    _renderSeasonCatBar(seasons);

    if (!activeSeason || !activeCat) {
      body.innerHTML = `<div class="gp-empty">No season data.</div>`;
      return;
    }

    _withScrollPreservation(() => {
      _renderSeasonStandings(body);
    });
  }

  function _renderSeasonCatBar(seasons) {
    const bar = document.getElementById("gp-cat-bar");
    if (!bar) return;
    bar.innerHTML = "";

    // Sélecteur d'année
    const yearSel = document.createElement("div");
    yearSel.className = "gp-season-year-sel";
    seasons.forEach((yr) => {
      const btn = document.createElement("button");
      btn.className =
        "gp-cat-btn gp-cat-has" + (activeSeason === yr ? " gp-cat-active" : "");
      btn.textContent = yr;
      btn.addEventListener("click", () => {
        activeSeason = yr;
        const cats = _getSeasonCats(yr);
        if (!cats.includes(activeCat)) activeCat = cats[0] || "";
        _renderBody();
      });
      yearSel.appendChild(btn);
    });
    bar.appendChild(yearSel);

    // Séparateur
    const sep = document.createElement("div");
    sep.className = "gp-cat-sep";
    bar.appendChild(sep);

    // Sélecteur de catégorie
    const cats = _getSeasonCats(activeSeason);
    if (!cats.includes(activeCat)) activeCat = cats[0] || "";

    cats.forEach((cat) => {
      const btn = document.createElement("button");
      btn.className =
        "gp-cat-btn gp-cat-has" + (activeCat === cat ? " gp-cat-active" : "");
      btn.style.setProperty("--cat-c", _catColor(cat));
      btn.textContent = cat;
      btn.addEventListener("click", () => {
        activeCat = cat;
        _renderBody();
      });
      bar.appendChild(btn);
    });
  }

  function _computeSeasonStandings(year, cat) {
    const gps = _getSeasonGPs(year, cat);
    const map = {};

    gps.forEach(({ wk, races }) => {
      RACE_ORDER.forEach((key) => {
        const race = races[key];
        if (!race) return;
        race.results.forEach((r) => {
          if (!map[r.nr])
            map[r.nr] = {
              fn: r.fn,
              ln: r.ln,
              bike: r.bike,
              nr: r.nr,
              gps: {},
              total: 0,
              wins: 0,
            };
          if (!map[r.nr].gps[wk]) map[r.nr].gps[wk] = {};
          map[r.nr].gps[wk][key] = { pos: r.pos, pts: r.pts };
          map[r.nr].total += r.pts; // QR + R1 + R2 = total championnat
          if (r.pos === 1 && key !== "QR") map[r.nr].wins++;
        });
      });
    });

    // Appliquer les pénalités (points en moins)
    return Object.values(map)
      .map((d) => ({
        ...d,
        penalty: _getPenalty(year, cat, d.nr),
        net: Math.max(0, d.total - _getPenalty(year, cat, d.nr)),
      }))
      .sort((a, b) => {
        if (b.net !== a.net) return b.net - a.net;
        return b.wins - a.wins;
      });
  }

  /** Lit la pénalité d'un rider dans allGPs._penalties.{year}.{cat}.{nr} */
  function _getPenalty(year, cat, nr) {
    try {
      const v = allGPs._penalties?.[year]?.[cat]?.[String(nr)];
      if (v == null || typeof v === "object") return 0;
      const n = typeof v === "number" ? v : parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  /** Écrit une pénalité dans Firebase et dans allGPs local */
  function _setPenalty(year, cat, nr, pts) {
    /* Les pénalités s'éditent désormais directement dans la console
       Firebase — plus d'écriture (ni de mutation locale trompeuse)
       depuis le navigateur. */
    if (!window.__MXGP_HEADLESS__) return;
    pts = Math.max(0, parseInt(pts) || 0);
    if (!allGPs._penalties) allGPs._penalties = {};
    if (!allGPs._penalties[year]) allGPs._penalties[year] = {};
    if (!allGPs._penalties[year][cat]) allGPs._penalties[year][cat] = {};
    if (pts === 0) {
      delete allGPs._penalties[year][cat][String(nr)];
    } else {
      allGPs._penalties[year][cat][String(nr)] = pts;
    }
    const url = `${FB_BASE}/gp/_penalties/${year}/${cat}/${nr}.json`;
    fetch(url, {
      method: pts === 0 ? "DELETE" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: pts === 0 ? undefined : JSON.stringify(pts),
    }).catch(() => {});
  }

  function _renderSeasonStandings(body) {
    if (!body) return;

    const gps = _getSeasonGPs(activeSeason, activeCat);
    const rows = _computeSeasonStandings(activeSeason, activeCat);

    if (!gps.length || !rows.length) {
      body.innerHTML = `<div class="gp-empty">No results for ${_esc(activeCat)} ${_esc(activeSeason)}.</div>`;
      return;
    }

    const leader = rows[0]?.net ?? 0;
    const hasPenalties = rows.some((r) => r.penalty > 0);

    let html = `<div class="gp-season-header">
      <span class="gp-season-title">${_esc(activeCat)} — Season ${_esc(activeSeason)}</span>
      <span class="gp-season-sub">${gps.length} GPs · ${rows.length} riders</span>
    </div>`;

    html += `<div class="gp-table-wrap gp-season-wrap"><table class="gp-table gp-season-table">
      <thead><tr>
        <th>#</th><th>Rider</th><th class="gp-th-bike">Bike</th>`;

    gps.forEach(({ wk }) => {
      html += `<th class="gp-col-gp">Rd ${_roundNumber(wk)}</th>`;
    });

    html += `<th class="gp-col-total">Brut</th>`;
    if (hasPenalties) {
      html += `<th class="gp-col-pen">Pen.</th>`;
    }
    html += `<th class="gp-col-total">Total</th><th class="gp-col-diff">Gap</th>
      </tr></thead><tbody>`;

    rows.forEach((r, idx) => {
      const pos = idx + 1;
      const posCls = pos <= 3 ? `gp-pos-${pos}` : "";
      const gap = idx === 0 ? "—" : `-${leader - r.net}`;
      const gapCls =
        idx === 0
          ? "gp-diff-leader"
          : leader - r.net <= 15
            ? "gp-diff-close"
            : "";

      html += `<tr class="${posCls}">
        <td class="gp-td-pos">${pos}</td>
        <td class="gp-td-name">
          <span class="gp-fn">${_esc(r.fn)}</span>
          <span class="gp-ln">${_esc(r.ln)}</span>
          <span class="gp-nr">#${r.nr}</span>
        </td>
        <td class="gp-td-bike gp-th-bike">${_esc(r.bike)}</td>`;

      gps.forEach(({ wk }) => {
        const gpRes = r.gps[wk];
        if (!gpRes) {
          html += `<td class="gp-td-gp gp-td-gp-abs"><span class="gp-sea-total">0</span><span class="gp-sea-detail">0 · 0</span></td>`;
        } else {
          const gpTotal =
            (gpRes.QR?.pts || 0) + (gpRes.R1?.pts || 0) + (gpRes.R2?.pts || 0);
          const qrtxt = gpRes.QR ? `${gpRes.QR.pts}` : null;
          const r1txt = gpRes.R1 ? `${gpRes.R1.pts}` : "0";
          const r2txt = gpRes.R2 ? `${gpRes.R2.pts}` : "0";
          const detail = qrtxt
            ? `${qrtxt} · ${r1txt} · ${r2txt}`
            : `${r1txt} · ${r2txt}`;
          html += `<td class="gp-td-gp">
            <span class="gp-sea-total">${gpTotal}</span>
            <span class="gp-sea-detail">${detail}</span>
          </td>`;
        }
      });

      // Colonne Brut
      html += `<td class="gp-td-total gp-td-brut">${r.total}</td>`;

      // Colonne pénalité
      if (hasPenalties) {
        if (false) {
          html += `<td class="gp-td-pen">
            <input class="gp-pen-input" type="number" min="0" max="999"
              value="${r.penalty}"
              data-nr="${r.nr}"
              title="Points retirés à ${_esc(r.ln)} au championnat"/>
          </td>`;
        } else {
          html += `<td class="gp-td-pen">${
            r.penalty > 0 ? `<span class="gp-pen-val">-${r.penalty}</span>` : ""
          }</td>`;
        }
      }

      // Colonne Total net (après pénalité)
      html += `<td class="gp-td-total">${r.net}</td>
        <td class="gp-td-diff ${gapCls}">${gap}</td>
      </tr>`;
    });

    html += `</tbody></table></div>`;
    body.innerHTML = html;

    // Brancher les inputs pénalité
    if (false) {
      body.querySelectorAll(".gp-pen-input").forEach((inp) => {
        inp.addEventListener("change", (e) => {
          const nr = e.target.dataset.nr;
          const pts = parseInt(e.target.value) || 0;
          _setPenalty(activeSeason, activeCat, nr, pts);
        });
      });
    }
  }

  /* ─────────────────────────────────────────────────────────
     LIVE WRITE (semaine courante uniquement)
  ───────────────────────────────────────────────────────── */
  function _writeLive() {
    /* Défense en profondeur : _startLiveLoop() (déclenché par
       l'ouverture du panel GP côté navigateur) appelle aussi cette
       fonction directement. Seul le script headless doit écrire. */
    if (!window.__MXGP_HEADLESS__) return;
    if (!latestMeta) return;
    const sessKey = _inferSessionKey(latestMeta);
    if (!sessKey) return;
    const cat = _inferMetaCategory(latestMeta);
    if (!cat) return;
    const wk = _weekKey();
    if (allGPs[wk]?.cats?.[cat]?.races?.[sessKey]) return;

    const riders = [...latestRiders]
      .filter((r) => r.pos && r.pos > 0)
      .sort((a, b) => a.pos - b.pos)
      .map((r, i) => ({
        pos: r.pos,
        nr: r.nr,
        fn: r.fn || "",
        ln: r.ln || "",
        bike: r.bike || "",
        nation: r.nation || "",
        pts: _ptsFor(cat, sessKey, r.pos, i),
      }));

    if (!riders.length) return;

    /* N'écrire que si le classement à points a changé, ou si le
       heartbeat de sécurité (30s) est dépassé — évite toute écriture
       Firebase inutile quand seules des positions hors des points
       bougent (aucun impact sur le classement affiché). */
    const sig = _liveSignature(cat, sessKey, riders);
    const now = Date.now();
    const stale = now - _liveLastWriteTs > LIVE_HEARTBEAT_MS;
    if (sig === _liveLastSig && !stale) return;

    _liveLastSig = sig;
    _liveLastWriteTs = now;

    fetch(`${_wkBase(wk)}/live.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cat, sessKey, ts: now, riders }),
    }).catch(() => {});
  }

  function _liveFirebaseTable(key, liveD) {
    const isMxon = _normalizeCat(liveD.cat) === MXON_CAT;
    const rows = (liveD.riders || [])
      .map((r) => {
        const pc = r.pos <= 3 ? `gp-pos-${r.pos}` : "";
        return `<tr class="${pc}">
        <td class="gp-td-pos">${r.pos}</td>
        <td class="gp-td-name">
          <span class="gp-fn">${_esc(r.fn)}</span>
          <span class="gp-ln">${_esc(r.ln)}</span>
          <span class="gp-nr">#${r.nr}</span>
        </td>
        <td class="gp-td-bike gp-th-bike">${_esc(r.bike)}</td>
        ${isMxon ? `<td class="gp-td-nat">${_natCell(r.nation)}</td>` : ""}
        <td class="gp-td-ptsrace">${r.pts}</td>
      </tr>`;
      })
      .join("");

    return `<div class="gp-race-header">
        <span class="gp-race-label">${RACE_LABEL[key] || key}</span>
        <span class="gp-race-auto gp-live-badge">🔴 LIVE</span>
        <span class="gp-live-age" id="gp-live-age"></span>
      </div>
      <div class="gp-table-wrap"><table class="gp-table">
        <thead><tr>
          <th>Pos</th><th>Rider</th>
          <th class="gp-th-bike">Bike</th>
          ${isMxon ? "<th>Nat</th>" : ""}
          <th>Pts</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function _previewTable(key, cat) {
    const isMxon = cat === MXON_CAT;
    const riders = [...latestRiders]
      .filter((r) => r.pos && r.pos > 0)
      .sort((a, b) => a.pos - b.pos);

    const rows = riders
      .map((r, i) => {
        const pts = _ptsFor(cat, key, r.pos, i);
        const pc = r.pos <= 3 ? `gp-pos-${r.pos}` : "";
        return `<tr class="${pc}">
        <td class="gp-td-pos">${r.pos}</td>
        <td class="gp-td-name">
          <span class="gp-fn">${_esc(r.fn || "")}</span>
          <span class="gp-ln">${_esc(r.ln || "")}</span>
          <span class="gp-nr">#${r.nr}</span>
        </td>
        <td class="gp-td-bike gp-th-bike">${_esc(r.bike || "")}</td>
        ${isMxon ? `<td class="gp-td-nat">${_natCell(r.nation)}</td>` : ""}
        <td class="gp-td-ptsrace">${pts}</td>
      </tr>`;
      })
      .join("");

    return `<div class="gp-race-header">
        <span class="gp-race-label">${RACE_LABEL[key] || key}</span>
        <span class="gp-race-auto gp-live-badge">🔴 LIVE</span>
      </div>
      <div class="gp-table-wrap"><table class="gp-table">
        <thead><tr>
          <th>Pos</th><th>Rider</th>
          <th class="gp-th-bike">Bike</th>
          ${isMxon ? "<th>Nat</th>" : ""}
          <th>Points</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  /* ─────────────────────────────────────────────────────────
     CAPTURE MANUELLE
  ───────────────────────────────────────────────────────── */
  function _capture() {
    if (!latestMeta && !currentCat) return _toast("No active session.");
    const liveMeta = latestMeta || cachedMeta;
    const key =
      _inferSessionKey(liveMeta) || _normalizeSessionType(currentSess || "");
    if (!key)
      return _toast(
        "Unrecognised session: " + (liveMeta?.sessType || currentSess || "?"),
      );
    if (!latestRiders.length) return _toast("No riders in session.");
    let cat = _inferMetaCategory(liveMeta) || _normalizeCat(currentCat || "");
    if (!cat) return _toast("Unknown category.");
    if (cat === MXON_CAT && key === "QR")
      return _toast("MXoN — Qualifying Race not counted, not saved.");

    const wk = _weekKey();

    if (!allGPs[wk]) allGPs[wk] = { cats: {}, live: null };
    /* FIX: guard against cats being undefined */
    if (!allGPs[wk].cats) allGPs[wk].cats = {};
    if (!allGPs[wk].cats[cat]) allGPs[wk].cats[cat] = { name: "", races: {} };
    const catD = allGPs[wk].cats[cat];
    if (!catD.name) {
      const gpTitle = (latestMeta?.title || "").split(" - ")[0]?.trim() || "";
      if (gpTitle) catD.name = gpTitle;
    }
    const gpFlag =
      latestMeta?.flag ||
      latestMeta?.nat ||
      latestMeta?.nation ||
      latestMeta?.country ||
      latestMeta?.nationality ||
      "";
    if (gpFlag && !allGPs[wk].flag) allGPs[wk].flag = gpFlag;

    const results = latestRiders
      .filter((r) => r.pos && r.pos > 0)
      .sort((a, b) => a.pos - b.pos)
      .map((r, i) => ({
        pos: r.pos,
        nr: r.nr,
        fn: r.fn || "",
        ln: r.ln || "",
        bike: r.bike || "",
        nation: r.nation || "",
        pts: _ptsFor(cat, key, r.pos, i),
      }));

    const raceData = { ts: Date.now(), auto: false, cat, results };
    catD.races[key] = raceData;
    /* force=true → always overwrite Firebase, even if a red-flag result was
       previously auto-saved. This is the main recovery path for restarts. */
    _writeRace(cat, key, raceData, catD.name, gpFlag, true);

    activeWeek = wk;
    activeCat = cat;
    activeTab = key;
    _updateHeaderBtn();
    _renderBody();
    _toast(`✔ ${RACE_LABEL[key]} ${cat} saved — ${results.length} riders`);
  }

  /* ─────────────────────────────────────────────────────────
     LIVE AGE
  ───────────────────────────────────────────────────────── */
  function _startLiveAgeRefresh(liveTs) {
    _stopLiveAgeRefresh();
    function _tick() {
      const el = document.getElementById("gp-live-age");
      if (!el) {
        _stopLiveAgeRefresh();
        return;
      }
      const age = Math.round((Date.now() - liveTs) / 1000);
      el.textContent =
        age < 60
          ? `updated ${age}s ago`
          : `updated ${Math.round(age / 60)}min ago`;
    }
    _tick();
    _liveRefresh = setInterval(_tick, 5_000);
  }

  function _stopLiveAgeRefresh() {
    if (_liveRefresh) {
      clearInterval(_liveRefresh);
      _liveRefresh = null;
    }
  }

  /* ─────────────────────────────────────────────────────────
     SYNC INDICATOR
  ───────────────────────────────────────────────────────── */
  function _updateSyncIndicator(connected) {
    const el = document.getElementById("gp-sync");
    if (!el) return;
    el.style.color = connected ? "#00cc55" : "rgba(255,255,255,0.2)";
    el.title = connected ? "Firebase — synced" : "Firebase — connecting…";
  }

  /* ─────────────────────────────────────────────────────────
     TOAST / NOTIF
  ───────────────────────────────────────────────────────── */
  function _toast(msg, warn = false) {
    const el = document.getElementById("gp-toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "gp-toast gp-toast-show" + (warn ? " gp-toast-warn" : "");
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove("gp-toast-show"), 3500);
  }

  function _showNotif(msg) {
    let el = document.getElementById("gp-notif");
    if (!el) {
      el = document.createElement("div");
      el.id = "gp-notif";
      el.className = "gp-notif";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("gp-notif-show");
    clearTimeout(notifTimer);
    notifTimer = setTimeout(() => el.classList.remove("gp-notif-show"), 5000);
  }

  /* ─────────────────────────────────────────────────────────
     UTILS
  ───────────────────────────────────────────────────────── */
  function _esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /** Petit drapeau + code nation, en réutilisant la table NAT_FLAGS de
   *  main.js (déjà chargé — même pattern que duel.js avec getBikeStyle).
   *  Retourne du HTML (gp.js construit des chaînes, pas des noeuds DOM). */
  function _natCell(nat) {
    const n = String(nat || "")
      .toUpperCase()
      .trim();
    if (!n) return '<span class="gp-nat-code">—</span>';
    const code = typeof NAT_FLAGS !== "undefined" ? NAT_FLAGS[n] : null;
    if (!code) return `<span class="gp-nat-code">${_esc(n)}</span>`;
    return `<img class="gp-nat-flag" src="https://flagpedia.net/data/flags/w580/${code}.webp" width="20" height="15" alt="${_esc(n)}" title="${_esc(n)}" />`;
  }

  function _fmtDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("fr-FR", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /* ════════════════════════════════════════════════════════════
     ── STATS MODULE → stats.js + stats.css ───────────────────
     Pour désactiver les stats : retirer stats.js et stats.css
     de index.html. Aucune modification de gp.js nécessaire.
  ════════════════════════════════════════════════════════════ */

  /** Retourne le nr (string) du leader du championnat pour une catégorie donnée.
   *  Utilise _computeSeasonStandings — même calcul que le tableau SEASON,
   *  donc toujours cohérent avec ce que l'utilisateur voit. */
  function getChampLeader(cat) {
    if (!cat) return null;
    const seasons = _getSeasons();
    if (!seasons.length) return null;
    const rows = _computeSeasonStandings(seasons[0], cat);
    return rows.length ? String(rows[0].nr) : null;
  }

  return { init, update, autoCapture, setCurrent, getChampLeader, testMxon };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => GP.init());
} else {
  GP.init();
}
