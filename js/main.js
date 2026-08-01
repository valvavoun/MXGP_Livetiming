/* ═══════════════════════════════════════════════
   MXGP Live Timing — main.js
   All logic: SignalR connection, parse, render.
═══════════════════════════════════════════════ */

/* ── Connection config ── */
const CFG = {
  base: "https://liveresults.mxgp.com/NotificationConnection",
  baseWS: "wss://liveresults.mxgp.com/NotificationConnection",
  proto: "2.0",
  retryMax: 20,
  retryMs: 3000,
};

/* ── Session durations in minutes — complete table per category ── */
const SESSION_DUR = {
  "Free Practice": {
    MXGP: 25,
    MX2: 25,
    WMX: 20,
    JMX65: 20,
    JMX85: 20,
    JMX125: 20,
    MXN: 40,
    _: 25,
  },
  "Time Practice": {
    MXGP: 25,
    MX2: 25,
    WMX: 25,
    JMX65: 20,
    JMX85: 20,
    JMX125: 20,
    _: 25,
  },
  "Qualifying Race": {
    MXGP: 20,
    MX2: 20,
    WMX: 20,
    JMX65: 10,
    JMX85: 10,
    JMX125: 10,
    MXN: 20,
    _: 20,
  },
  "Warm-Up": { MXGP: 15, MX2: 15, JMX65: 15, JMX85: 15, JMX125: 15, _: 15 },
  "Warm-Up B-Final": { _: 15 },
  "Warm-Up MXN Group 1": { _: 15 },
  "Warm-Up MXN Group 2": { _: 15 },
  "Race 1": {
    MXGP: 30,
    MX2: 30,
    WMX: 20,
    JMX65: 12,
    JMX85: 20,
    JMX125: 25,
    MXN: 30,
    _: 30,
  },
  "Race 2": {
    MXGP: 30,
    MX2: 30,
    WMX: 20,
    JMX65: 12,
    JMX85: 20,
    JMX125: 25,
    MXN: 30,
    _: 30,
  },
  "Last Chance Race": { JMX65: 10, JMX85: 10, JMX125: 10, _: 10 },
  "Sighting Laps": { WMX: 10, _: 10 },
  "C-Final": { _: 20 },
  "B-Final": { _: 20 },
};

/* Sessions that end on time then continue for 2 extra laps */
const SESSION_EXTRA_LAPS = new Set([
  "Qualifying Race",
  "Race 1",
  "Race 2",
  "Last Chance Race",
  "C-Final",
  "B-Final",
]);

function getSessionDurSec(cat, sess) {
  /* Also match MXN race patterns like "Race MXGP/MX2" */
  if (!sess) return null;
  const row = SESSION_DUR[sess];
  if (row) return (row[cat] || row._) * 60;
  /* Fallback: MXN race/qualifying variants */
  if (/^Race\s+/i.test(sess)) return 30 * 60;
  if (/^Qualifying Race\s+/i.test(sess)) return 20 * 60;
  if (/^C-Final/i.test(sess)) return 20 * 60;
  if (/^B-Final/i.test(sess)) return 20 * 60;
  if (/^Warm-Up/i.test(sess)) return 15 * 60;
  if (/^Free Practice/i.test(sess)) return (cat === "MXN" ? 40 : 25) * 60;
  return null;
}

function sessionHasExtraLaps(sess) {
  if (!sess) return false;
  if (SESSION_EXTRA_LAPS.has(sess)) return true;
  /* MXN race variants */
  return (
    /^Race\s+/i.test(sess) ||
    /^Qualifying Race\s+/i.test(sess) ||
    /^C-Final/i.test(sess) ||
    /^B-Final/i.test(sess) ||
    /^Last Chance Race/i.test(sess)
  );
}

/* ── Brand display names ── */
const BRAND_NAMES = {
  MXGP: "MXGP",
  MX2: "MX2",
  WMX: "WOMEN'S MX",
  JMX65: "JUNIOR MX 65",
  JMX85: "JUNIOR MX 85",
  JMX125: "JUNIOR MX 125",
  MXN: "MX OF NATIONS",
};

/* ── Bike brand colours for nr-badge background ── */

const BIKE_COLORS = {
  KTM: { bg: "#ff6600", fg: "#fff" }, // Orange
  HUS: { bg: "#969696", fg: "#fff" }, // Bleu foncé
  GAS: { bg: "#ff1a1a", fg: "#fff" }, // Rouge clair (GasGas)
  HON: { bg: "#cc0000", fg: "#fff" }, // Rouge pur (Honda)
  KAW: { bg: "#00a651", fg: "#fff" }, // Vert
  YAM: { bg: "#0033a0", fg: "#fff" }, // Bleu
  TM: { bg: "#0057b8", fg: "#fff" }, // Bleu clair
  TRI: { bg: "#ffd100", fg: "#fff" }, // Jaune Triumph 🔥
  BET: { bg: "#a0002a", fg: "#fff" }, // Rouge foncé (Beta)
  DUC: { bg: "#ffffff", fg: "#242424" }, // Rouge vif (Ducati)
  FAN: { bg: "#1e1e1e", fg: "#fff" }, // Noir
};

function getBikeStyle(bikeName) {
  const b = (bikeName || "").toUpperCase().trim();
  for (const key of Object.keys(BIKE_COLORS)) {
    if (b.includes(key)) return BIKE_COLORS[key];
  }
  return null; // use default CSS
}

/* ── nationality flags for Nat column ── */

const NAT_FLAGS = {
  FRA: "fr",
  BEL: "be",
  NED: "nl",
  GER: "de",
  ITA: "it",
  ESP: "es",
  GBR: "gb",
  USA: "us",
  AUS: "au",
  SWE: "se",
  NOR: "no",
  DEN: "dk",
  FIN: "fi",
  SUI: "ch",
  AUT: "at",
  POR: "pt",
  CZE: "cz",
  POL: "pl",
  BRA: "br",
  CAN: "ca",
  NZL: "nz",
  JPN: "jp",
  RSA: "za",
  SLO: "si",
  LAT: "lv",
  EST: "ee",
  LTU: "lt",
  SVK: "sk",
  HUN: "hu",
  CRO: "hr",
  BUL: "bg",
  ROU: "ro",
  SRB: "rs",
  CHI: "cl",
  COL: "co",
  MEX: "mx",
  ARG: "ar",
  INA: "id",
  THA: "th",
  CHN: "cn",
  LIE: "li",
  ISR: "il",
};

function getNatFlag(nat) {
  const n = (nat || "").toUpperCase().trim();
  const code = NAT_FLAGS[n];
  if (!code) {
    const span = document.createElement("span");
    span.className = "nat-code";
    span.textContent = n || "—";
    return span;
  }
  const img = document.createElement("img");
  img.src = `https://flagpedia.net/data/flags/w580/${code}.webp`;
  img.width = 24;
  img.height = 18;
  img.className = "flag-img";
  img.alt = n;
  return img;
}

/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */
let ws = null;
let msgCount = 0;
let retries = 0;
let retryTmr = null;

let prevRender = {}; // nr → { pos, ll, posCls }  — posCls persists until next lap change
let sectorState = {}; // nr → { s1:{val,st}, s1_pb, s2..s4 } — persistent sector colours
let riderStartPos = {}; // nr → first position seen — for Δ pos column
let prevClockSec = null;
let clockDir = null; // 'up' | 'down' | null
let posColorState = {}; // nr → { timerId, color } — manages 5s pos-gained/lost flashes

/* ── Delay queue ── */
let delayMs = 0;
const msgQueue = []; // { data, receivedAt }
let delayCountdown = 0;
let delayCountdownTimer = null;

/* ── Cache meta valide pour FINISHED ── */
let cachedMeta = null;
setInterval(() => {
  if (!msgQueue.length) return;
  const now = Date.now();
  while (msgQueue.length && now - msgQueue[0].receivedAt >= delayMs) {
    onMsg(msgQueue.shift().data);
  }
}, 200);

/* Once set to true, stays true until a NEW session is detected */
let sessionFinished = false;

let currentCat = "";
let currentSess = "";

/* ═══════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════ */
function lg(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}

/** Parse lap-time string "M:SS.mmm" or "SS.mmm" → seconds. */
function s2t(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m;
  m = s.match(/^(\d+):(\d{2})\.(\d{1,3})$/);
  if (m) return +m[1] * 60 + +m[2] + +m[3].padEnd(3, "0") / 1000;
  m = s.match(/^(\d{1,3})\.(\d{1,3})$/);
  if (m) return +m[1] + +m[2].padEnd(3, "0") / 1000;
  return null;
}

function dpClass(c) {
  if (!c) return "dp-none";
  if (c === "ff6666") return "dp-red";
  if (c === "ccffcc" || c === "00cc00") return "dp-green";
  if (c === "ff6600") return "dp-orange";
  if (c === "ff3300") return "dp-orange2";
  return "dp-none";
}

function llClass(c) {
  if (!c) return "ll-none";
  if (c === "ccffcc" || c === "00cc00") return "ll-green";
  if (c === "ff6666" || c === "ff3300") return "ll-red";
  return "ll-none";
}

function esc(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ═══════════════════════════════════════════════
   UI STATE MACHINE
═══════════════════════════════════════════════ */
const UI_STATES = {
  connecting: { cls: "st-connecting", bar: "" },
  live: { cls: "st-live", bar: "live" },
  finished: { cls: "st-finished", bar: "" },
  reconnect: { cls: "st-reconnect", bar: "retry" },
  error: { cls: "st-finished", bar: "error" },
};

function setUI(state, label, barTxt, barDt) {
  const s = UI_STATES[state] || UI_STATES.connecting;

  document.getElementById("live-lbl").textContent = label;
  document.getElementById("live-badge").className = "live-badge " + s.cls;

  const showBar =
    state === "connecting" || state === "reconnect" || state === "error";
  const bar = document.getElementById("cbar");
  bar.className = "cbar " + (showBar ? s.bar : "hidden");
  document.getElementById("cbar-txt").textContent = barTxt || "";
  document.getElementById("cbar-dt").textContent = barDt || "";
  document.documentElement.style.setProperty("--cbh", showBar ? "30px" : "0px");
}

/* ═══════════════════════════════════════════════
   THEAD HORIZONTAL SCROLL SYNC
   thead-wrap has overflow:hidden → clips .thead content.
   When tbl-wrap scrolls right, we translateX .thead left
   so both appear to scroll in sync.
═══════════════════════════════════════════════ */
function initScrollSync() {
  const tblWrap = document.getElementById("tbl-wrap");
  const thead = document.getElementById("thead");
  if (!tblWrap || !thead || tblWrap._syncDone) return;
  tblWrap._syncDone = true;
  tblWrap.addEventListener(
    "scroll",
    () => {
      thead.style.transform = `translateX(-${tblWrap.scrollLeft}px)`;
    },
    { passive: true },
  );
}

/* ═══════════════════════════════════════════════
   1. NEGOTIATE
═══════════════════════════════════════════════ */
async function negotiate() {
  /* FIX: si la session est déjà marquée FINISHED, ne pas écraser le badge
     avec l'état "connecting" pendant les tentatives de reconnexion en
     arrière-plan (le serveur mxgp ferme la connexion en fin de course,
     ce qui relance négociate()/connectWS() en boucle et faisait clignoter
     le badge entre FINISHED et CONNECTING…/OFFLINE). */
  if (!sessionFinished)
    setUI("connecting", "NEGOTIATING…", "GET /negotiate…", CFG.base);

  const url = `${CFG.base}/negotiate?clientProtocol=${CFG.proto}&_=${Date.now()}`;

  try {
    const r = await fetchTO(url, 6000);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    if (!d.ConnectionToken) throw new Error("No token");
    lg("NEG", "✅ Direct OK");
    connectWS(d.ConnectionToken);
    return;
  } catch (e1) {
    lg("NEG", "Direct: " + e1.message + " → proxy…");
  }

  try {
    const r = await fetchTO(
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
      7000,
    );
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    if (!d.ConnectionToken) throw new Error("No token");
    lg("NEG", "✅ Proxy OK");
    connectWS(d.ConnectionToken);
    return;
  } catch (e2) {
    lg("NEG", "Proxy: " + e2.message + " → raw WS");
  }

  connectWS(null);
}

function fetchTO(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/* ═══════════════════════════════════════════════
   2. WEBSOCKET
═══════════════════════════════════════════════ */
function connectWS(token) {
  if (ws) {
    try {
      ws.close();
    } catch (e) {}
    ws = null;
  }

  const url = token
    ? `${CFG.baseWS}/connect?transport=webSockets&clientProtocol=${CFG.proto}&connectionToken=${encodeURIComponent(token)}&tid=${(Math.random() * 10) | 0}`
    : `${CFG.baseWS}/connect?transport=webSockets&clientProtocol=${CFG.proto}&tid=${(Math.random() * 10) | 0}`;

  /* FIX: idem — ne pas repasser en "connecting" si déjà FINISHED */
  if (!sessionFinished)
    setUI("connecting", "CONNECTING…", "Opening WebSocket…", "");
  try {
    ws = new WebSocket(url);
  } catch (e) {
    scheduleRetry();
    return;
  }

  ws.onopen = () => {
    retries = 0;
    lg("WS", "✅ Connected");
    /* Reset position tracking — évite les faux pos-gained/lost après reconnexion */
    Object.values(posColorState).forEach((s) => clearTimeout(s.timerId));
    posColorState = {};
    prevRender = {};
    /* FIX #7: if session was already finished, restore that state on reconnect */
    if (sessionFinished) setUI("finished", "FINISHED", "", "");
    else setUI("live", "LIVE", "✔ Connected — liveresults.mxgp.com", "");
    if (token) sendStart(token);

    /* FIX: if no session is broadcasting riders, the loader stays forever.
       After 8 s still connected with no render, replace loader with a waiting msg. */
    setTimeout(() => {
      const tbody = document.getElementById("tbody");
      if (tbody && tbody.querySelector(".loading")) {
        tbody.innerHTML =
          '<div class="loading"><div class="load-txt" style="opacity:.4;font-size:11px;letter-spacing:2px">' +
          "CONNECTED — WAITING FOR NEXT SESSION…</div></div>";
      }
    }, 8000);
  };

  ws.onmessage = (ev) => {
    msgCount++;
    try {
      const data = JSON.parse(ev.data);
      if (delayMs === 0) {
        onMsg(data);
      } else {
        msgQueue.push({ data, receivedAt: Date.now() });
      }
    } catch (e) {
      lg("MSG", "❌ " + e.message);
    }
  };

  ws.onerror = () => lg("WS", "❌ socket error");

  ws.onclose = (ev) => {
    lg("WS", "Closed code:" + ev.code);
    /* FIX #7: only show reconnecting if session wasn't finished */
    if (!sessionFinished)
      setUI(
        "reconnect",
        "RECONNECTING…",
        "Lost connection…",
        "code:" + ev.code,
      );
    scheduleRetry();
  };
}

async function sendStart(token) {
  try {
    await fetch(
      `${CFG.base}/start?transport=webSockets&clientProtocol=${CFG.proto}&connectionToken=${encodeURIComponent(token)}&_=${Date.now()}`,
      { mode: "cors" },
    );
  } catch (e) {}
}

function scheduleRetry() {
  if (retryTmr) return;
  if (retries >= CFG.retryMax) {
    /* FIX: idem — garder le badge FINISHED plutôt que de passer en OFFLINE */
    if (!sessionFinished)
      setUI("error", "OFFLINE", "Max retries — please reload the page", "");
    return;
  }
  retries++;
  retryTmr = setTimeout(
    () => {
      retryTmr = null;
      negotiate();
    },
    Math.min(CFG.retryMs * retries, 20000),
  );
}

/* ═══════════════════════════════════════════════
   3. MESSAGE HANDLER
═══════════════════════════════════════════════ */
function onMsg(msg) {
  if (msg.S === 1) return;
  if (!msg.M?.length) return;
  const p = msg.M[0];
  if (!p?.Data) return;
  const raw = String(p.Data);
  if (raw.trim()[0] === "{" || raw.trim()[0] === "[") return;

  const { meta, riders, bestSecTimes, bestLap } = parse(raw);

  /* Mettre à jour le cache du meta avec les données valides */
  if (meta.category && meta.sessType) {
    cachedMeta = { ...meta };
  } else if (cachedMeta) {
    /* Si le nouveau meta est incomplet, garder les infos du cache */
    meta.category = meta.category || cachedMeta.category;
    meta.sessType = meta.sessType || cachedMeta.sessType;
  }

  /* Detect session change → reset per-session state */
  if (meta.category && meta.sessType) {
    const newSess = meta.category + "-" + meta.sessType;
    const oldSess = currentCat + "-" + currentSess;
    if (newSess !== oldSess && oldSess !== "-") {
      lg("SESSION", `New session: ${newSess}`);
      sectorState = {};
      riderStartPos = {};
      prevRender = {};
      sessionFinished = false;
    }
  }

  /* Update brand / header */
  if (meta.category) {
    currentCat = meta.category;
    const brandName = BRAND_NAMES[meta.category] || meta.category;
    document.getElementById("brand-cat").textContent = brandName;
    document.getElementById("t-cat").textContent = meta.category;
    if (typeof GP !== "undefined") GP.setCurrent(currentCat, currentSess);
  }
  if (meta.sessType) {
    currentSess = meta.sessType;
    const subName = currentCat
      ? currentCat + " · " + meta.sessType
      : meta.sessType;
    document.getElementById("brand-sess").textContent = subName;
    if (typeof GP !== "undefined") GP.setCurrent(currentCat, currentSess);
  }

  /* Clock */
  if (meta.time) updateClock(meta.time, meta.status);

  /* FIX #7: badge — once finished, stay finished until new session.
     FIX: "Finished" peut arriver soit dans le statut (bold dédié),
     soit dans le champ time selon la variante du flux — on teste
     les deux plutôt que de dépendre uniquement de meta.status. */
  if (meta.status || meta.time) {
    const isFinished = `${meta.status || ""} ${meta.time || ""}`
      .toLowerCase()
      .includes("finish");
    if (isFinished) {
      /* ── Auto-save GP results on FIRST finish detection ── */
      let captureHandled = true; // par défaut : rien à faire (GP absent, etc.)
      if (!sessionFinished && typeof GP !== "undefined") {
        /* Utiliser le meta mergé avec le cache + currentCat/currentSess comme fallback */
        const finalMeta = { ...meta };
        if (!finalMeta.category) {
          finalMeta.category = cachedMeta?.category || currentCat;
        }
        if (!finalMeta.sessType) {
          finalMeta.sessType = cachedMeta?.sessType || currentSess;
        }

        if (finalMeta.category && finalMeta.sessType) {
          /* FIX: try/catch so that a GP.autoCapture crash never blocks
             sessionFinished=true — without this, every subsequent message
             re-throws and render() is never called (page stuck at loader) */
          try {
            /* FIX: si autoCapture renvoie false (ex: connexion en plein
               milieu d'un "Finished" sans encore la liste des pilotes),
               on NE verrouille PAS sessionFinished — on réessaiera au
               prochain message reçu, au lieu de rater la sauvegarde
               définitivement. */
            captureHandled = GP.autoCapture(riders, finalMeta) !== false;
          } catch (e) {
            console.warn("[MAIN] autoCapture error:", e);
            captureHandled = true; // éviter une boucle d'erreurs infinie
          }
        }
      }
      if (captureHandled) sessionFinished = true;
      setUI("finished", "FINISHED", "", "");
    } else if (!sessionFinished) {
      setUI("live", "LIVE", "✔ Connected — liveresults.mxgp.com", "");
    }
  }

  if (!riders.length) return;

  /* Snapshot prevRender BEFORE it gets updated in render() */
  const renderSnap = {};
  riders.forEach((r) => {
    const pr = prevRender[r.nr] || {};
    /* Lap changed → recompute posCls; otherwise keep existing colour */
    const lapChanged = pr.ll !== undefined && pr.ll !== r.ll1;
    let posCls = pr.posCls || "";
    if (pr.pos === undefined) {
      posCls = ""; /* first appearance */
    } else if (lapChanged) {
      /* New lap: compare new pos to pos recorded at start of prev lap */
      if (r.pos < pr.pos) posCls = "pos-gained";
      else if (r.pos > pr.pos) posCls = "pos-lost";
      else posCls = "";
    }
    /* If no lap change, posCls keeps its previous value (colour stays the full lap) */
    renderSnap[r.nr] = { pos: pr.pos, ll: pr.ll, posCls };
    /* Capture starting position on first appearance */
    if (!riderStartPos[r.nr]) riderStartPos[r.nr] = r.pos;
  });

  render(riders, bestSecTimes, bestLap, renderSnap);

  /* GP standings — transmet riders + meta à gp.js à chaque message */
  if (typeof GP !== "undefined") GP.update(riders, meta);

  /* Manage 5-second position color flashes */
  riders.forEach((r) => {
    const posEl = document.querySelector(`[data-rider-nr="${r.nr}"] .c-pos`);
    if (!posEl) return;

    const prevState = posColorState[r.nr] || {};
    const prev = renderSnap[r.nr] || {};

    /* Detect position change — compare with OLD position from renderSnap */
    if (prev.pos !== undefined && prev.pos !== r.pos) {
      /* Position CHANGED — apply new color & timer */
      if (prevState.timerId) clearTimeout(prevState.timerId);

      let colorCls = "";
      if (r.pos < prev.pos) colorCls = "pos-gained";
      else if (r.pos > prev.pos) colorCls = "pos-lost";

      if (colorCls) {
        posEl.classList.remove("pos-gained", "pos-lost");
        posEl.classList.add(colorCls);

        const timerId = setTimeout(() => {
          const el = document.querySelector(`[data-rider-nr="${r.nr}"] .c-pos`);
          if (el) el.classList.remove(colorCls);
          delete posColorState[r.nr];
        }, 5000);

        posColorState[r.nr] = { timerId, color: colorCls };
      }
    } else if (prevState.timerId) {
      /* Timer is running — reapply the class since DOM was re-rendered */
      posEl.classList.add(prevState.color);
    } else {
      /* No change AND no active timer — remove colors */
      delete posColorState[r.nr];
      posEl.classList.remove("pos-gained", "pos-lost");
    }
  });

  buildTicker(riders, meta);
  initScrollSync(); /* attach once, idempotent */

  /* Mode Duel — mettre à jour le panel de comparaison */
  if (typeof Duel !== "undefined") Duel.update(riders);
}

/* ═══════════════════════════════════════════════
   4. CLOCK
   Always shows computed REMAINING time.
   When time expires on a +2-laps session → "2 TOURS".
   When server says Finished → muted / hidden.
═══════════════════════════════════════════════ */
function updateClock(timeStr, statusStr) {
  const parts = timeStr.split(":");
  const isFinished = `${statusStr || ""} ${timeStr || ""}`
    .toLowerCase()
    .includes("finish");

  const toSec = (p) =>
    p.reduce((a, v, i) => a + +v * Math.pow(60, p.length - 1 - i), 0);
  const curSec = toSec(parts);

  /* Detect direction: count-down = server sends remaining, count-up = elapsed */
  if (!isFinished && prevClockSec !== null && !isNaN(curSec)) {
    const d = curSec - prevClockSec;
    if (d < -0.5) clockDir = "down";
    else if (d > 0.5) clockDir = "up";
  }
  prevClockSec = curSec;

  const clockEl = document.getElementById("race-clock");
  const lblEl = document.getElementById("clock-lbl");

  /* ── Helpers ── */
  function setClockParts(segArr) {
    clockEl.textContent = "";
    segArr.forEach((seg, i) => {
      clockEl.appendChild(document.createTextNode(seg));
      if (i < segArr.length - 1) {
        const s = document.createElement("span");
        s.className = "s";
        s.textContent = ":";
        clockEl.appendChild(s);
      }
    });
  }
  function mm_ss(m, s) {
    return [String(m).padStart(2, "0"), String(s).padStart(2, "0")];
  }
  function partsSegs(p) {
    return p.length >= 3
      ? [p[0], p[1], p[2]]
      : [p[0], String(p[1] || "00").padStart(2, "0")];
  }
  function clockColor(cls) {
    clockEl.className = ("race-clock " + cls).trim();
  }
  function lblShow(txt, cls) {
    lblEl.textContent = txt;
    lblEl.className = ("clock-lbl " + cls).trim();
    lblEl.style.display = "";
  }

  /* ── Finished: mute clock, hide label ── */
  if (isFinished) {
    clockColor("clock-finished");
    lblEl.style.display = "none";
    return;
  }

  /* ── Compute remaining seconds ── */
  let remSec = null;

  if (clockDir === "down") {
    /* Server already sends remaining time */
    remSec = curSec;
  } else if (clockDir === "up") {
    /* Server sends elapsed → compute remaining from session duration table */
    const totalSec = getSessionDurSec(currentCat, currentSess);
    if (totalSec !== null) remSec = totalSec - curSec;
  }

  /* ── Display ── */

  if (remSec === null) {
    /* Direction not yet known — show raw value, no label */
    setClockParts(partsSegs(parts));
    clockColor("");
    lblEl.style.display = "none";
    return;
  }

  if (remSec > 0) {
    /* ── Counting down → show remaining time ── */
    const rm = Math.floor(remSec / 60);
    const rs = Math.floor(remSec % 60);
    setClockParts(mm_ss(rm, rs));
    clockColor(rm < 2 ? "clock-urgent" : "");
    lblShow("TIME LEFT", rm < 2 ? "lbl-accent" : "lbl-muted");
  } else {
    /* ── Time expired ── */
    if (sessionHasExtraLaps(currentSess)) {
      /* Race/qualifying with +2 laps → show "2 TOURS" until server says Finished */
      clockEl.textContent = "2 LAPS";
      clockColor("clock-extralaps");
      lblShow("TIME OVER — LAST 2 LAPS", "lbl-extralaps");
    } else {
      /* Pure timed session (practice, warm-up) → show 00:00 */
      setClockParts(mm_ss(0, 0));
      clockColor("clock-urgent");
      lblShow("SESSION ENDED", "lbl-muted");
    }
  }
}

/* ═══════════════════════════════════════════════
   5. PARSE HTML FROM SERVER
═══════════════════════════════════════════════ */
function parse(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = doc.querySelectorAll("table");

  /* Meta from table[0] bold elements */
  const bolds = Array.from(tables[0]?.querySelectorAll("b") || []).map((b) =>
    b.textContent.trim(),
  );
  const title = bolds[0] || "";
  const parts = title.split(" - ");
  const _rawCat = parts[1]?.trim() || "";
  const _shifted = _rawCat.includes(" ") && parts.length >= 4;

  /* FIX: le statut de session ("Finished", "Live", …) n'est pas toujours
     le 2ᵉ <b> du tableau — certains messages du flux insèrent un <b>
     supplémentaire (météo, meilleur tour, etc.) avant ou après, ce qui
     décale l'index et empêche "Finished" d'être détecté (badge header
     et auto-save restent bloqués sur l'état précédent).
     → on cherche, parmi TOUS les bolds après le titre, celui qui
     correspond à un statut de session connu, au lieu de figer l'index. */
  const STATUS_WORDS =
    /\b(live|running|finished|not\s*started|interrupted|suspended|red\s*flag|delayed|cancelled|postponed)\b/i;
  const statusBold = bolds.slice(1).find((b) => STATUS_WORDS.test(b));

  const meta = {
    title,
    category: _shifted ? parts[2]?.trim() || "" : _rawCat,
    sessType: _shifted ? parts[3]?.trim() || "" : parts[2]?.trim() || "",
    time: _shifted ? parts[4]?.trim() || "" : parts[3]?.trim() || "",
    status: statusBold || bolds[1] || "",
  };

  /* Riders from table[1] */
  const rows = Array.from(tables[1]?.querySelectorAll("tr") || []);
  if (!rows.length)
    return { meta, riders: [], bestSecTimes: null, bestLap: null };

  const hcells = Array.from(rows[0].querySelectorAll("td,th"));
  const colMap = {};
  hcells.forEach((c, i) => {
    colMap[c.textContent.trim().toLowerCase()] = i;
  });
  if (!("pos" in colMap))
    return { meta, riders: [], bestSecTimes: null, bestLap: null };

  const txt = (cells, name) =>
    cells[colMap[name.toLowerCase()]]?.textContent?.trim() || "";
  const bgc = (cells, name) => {
    const i = colMap[name.toLowerCase()];
    if (i === undefined) return null;
    return (
      (
        cells[i]?.getAttribute("bgcolor") ||
        cells[i]?.getAttribute("bgColor") ||
        ""
      )
        .trim()
        .replace(/[#\s]/g, "")
        .toLowerCase() || null
    );
  };

  const riders = [];
  let bestSecTimes = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cells = Array.from(row.querySelectorAll("td"));
    if (!cells.length) continue;

    /* Best section times — special colspan row */
    if (cells[0]?.getAttribute("colspan")) {
      const ac = Array.from(row.querySelectorAll("td"));
      if (ac.length >= 5) {
        bestSecTimes = {
          label: ac[0]?.textContent?.trim() || "BEST SECTION TIMES",
          s1: ac[1]?.textContent?.trim() || "",
          s2: ac[2]?.textContent?.trim() || "",
          s3: ac[3]?.textContent?.trim() || "",
          s4: ac[4]?.textContent?.trim() || "",
          s1c: (
            ac[1]?.getAttribute("bgcolor") ||
            ac[1]?.getAttribute("bgColor") ||
            ""
          )
            .replace(/[#\s]/g, "")
            .toLowerCase(),
          s2c: (
            ac[2]?.getAttribute("bgcolor") ||
            ac[2]?.getAttribute("bgColor") ||
            ""
          )
            .replace(/[#\s]/g, "")
            .toLowerCase(),
          s3c: (
            ac[3]?.getAttribute("bgcolor") ||
            ac[3]?.getAttribute("bgColor") ||
            ""
          )
            .replace(/[#\s]/g, "")
            .toLowerCase(),
          s4c: (
            ac[4]?.getAttribute("bgcolor") ||
            ac[4]?.getAttribute("bgColor") ||
            ""
          )
            .replace(/[#\s]/g, "")
            .toLowerCase(),
        };
      }
      continue;
    }

    const posVal = parseInt(txt(cells, "Pos").replace(/\D/g, ""));
    if (isNaN(posVal) || posVal < 1 || posVal > 60) continue;

    const riderRaw = txt(cells, "Rider");
    let fn = "",
      ln = riderRaw;
    const comma = riderRaw.indexOf(",");
    if (comma > -1) {
      ln = riderRaw.substring(0, comma).trim();
      fn = riderRaw.substring(comma + 1).trim();
    } else {
      const p = riderRaw.split(/\s+/);
      if (p.length >= 2) {
        fn = p[0];
        ln = p.slice(1).join(" ");
      }
    }

    riders.push({
      pos: posVal,
      fn,
      ln,
      nr: txt(cells, "Nr"),
      nation: txt(cells, "Nation"),
      bike: txt(cells, "Bike"),
      time: txt(cells, "Time"),
      laps: txt(cells, "laps"),
      df: txt(cells, "Diff. First"),
      dp: txt(cells, "Diff. Prev."),
      dpc: bgc(cells, "Diff. Prev."),
      best: txt(cells, "Bestlaptime"),
      inlap: txt(cells, "in lap"),
      ll1: txt(cells, "Lastlaptime"),
      ll2: txt(cells, "Lastlap-2"),
      ll3: txt(cells, "Lastlap-3"),
      ll1c: bgc(cells, "Lastlaptime"),
      ll2c: bgc(cells, "Lastlap-2"),
      ll3c: bgc(cells, "Lastlap-3"),
      s1: txt(cells, "Section 1"),
      s2: txt(cells, "Section 2"),
      s3: txt(cells, "Section 3"),
      s4: txt(cells, "Section 4"),
      pass: txt(cells, "Last passing"),
      ob: false,
    });
  }

  riders.sort((a, b) => a.pos - b.pos);

  /* Overall best lap */
  const bestT = Math.min(...riders.map((r) => s2t(r.best)).filter(Boolean));
  if (isFinite(bestT))
    riders.forEach((r) => {
      r.ob = !!(s2t(r.best) && Math.abs(s2t(r.best) - bestT) < 0.01);
    });

  /* ────────────────────────────────────────────
     SECTOR COLOUR LOGIC
     Rules:
     1. Purple = session best (EXACTLY ONE rider per sector at any time)
     2. Green  = personal best this session (faster than rider's own pb)
     3. Default (muted) = anything else — NO RED
     4. Values persist until replaced by a new non-empty value (FIX #4)
     5. When a rider beats the session best, the previous holder loses purple (FIX #3)
  ─────────────────────────────────────────────── */
  const sessionBest = {
    s1: s2t(bestSecTimes?.s1),
    s2: s2t(bestSecTimes?.s2),
    s3: s2t(bestSecTimes?.s3),
    s4: s2t(bestSecTimes?.s4),
  };

  /* Pass 1: determine which rider currently holds session best per sector
     (based on whose time == bestSecTimes value sent by server) */
  const bestHolder = { s1: null, s2: null, s3: null, s4: null };
  ["s1", "s2", "s3", "s4"].forEach((sec) => {
    const bst = sessionBest[sec];
    if (!bst) return;
    riders.forEach((r) => {
      const t = s2t(r[sec]);
      if (t && Math.abs(t - bst) < 0.002) bestHolder[sec] = r.nr;
    });
  });

  /* Pass 2: assign/update colours */
  ["s1", "s2", "s3", "s4"].forEach((sec) => {
    riders.forEach((r) => {
      if (!sectorState[r.nr]) sectorState[r.nr] = {};
      const stored = sectorState[r.nr][sec] || { val: "", st: "sec-none" };
      const cur = r[sec] || "";

      /* FIX #4: empty value → keep previous colour, do NOT reset */
      if (cur === "") {
        r[sec + "st"] = stored.st;
        /* keep stored as-is so next non-empty value triggers recalc */
        return;
      }

      const isBestHolder = bestHolder[sec] === r.nr;
      const wasBestHolder = stored.st === "sec-best";
      const valueChanged = cur !== stored.val;
      /* FIX #3: recalc also when value is same but we're no longer the best holder */
      const needsRecalc = valueChanged || (wasBestHolder && !isBestHolder);

      if (!needsRecalc) {
        r[sec + "st"] = stored.st;
        return;
      }

      /* Recalculate colour */
      const t = s2t(cur);
      let st = "sec-none";

      if (t) {
        if (isBestHolder) {
          st = "sec-best"; // 🟣 session best
          /* this time IS the personal best too */
          sectorState[r.nr][sec + "_pb"] = t;
        } else {
          const pb = sectorState[r.nr][sec + "_pb"] ?? null;
          if (pb !== null && t < pb - 0.001) {
            st = "sec-good"; // 🟢 personal best
          }
          /* FIX #6: slower than pb → sec-none (muted), never red */
          /* Update pb regardless */
          if (valueChanged) {
            sectorState[r.nr][sec + "_pb"] = pb === null ? t : Math.min(pb, t);
          }
        }
      }

      r[sec + "st"] = st;
      sectorState[r.nr][sec] = { val: cur, st };
    });
  });

  /* ── Fill empty sectors with last known display value ──
     When the server sends "" for S2/S3/S4 (rider is in a new lap but
     hasn't reached those gates yet), show the previous lap's time.
     Done AFTER state logic so sectorState is not modified. */
  ["s1", "s2", "s3", "s4"].forEach((sec) => {
    riders.forEach((r) => {
      if (!r[sec]) {
        r[sec] = sectorState[r.nr]?.[sec]?.val || "";
      }
    });
  });

  /* Active sector from last passing gate */
  riders.forEach((r) => {
    const pl = (r.pass || "").toLowerCase().trim();
    let as = null;
    if (pl === "" || pl === "start" || pl.includes("finish")) as = "s1";
    else if (pl.includes("inter 1")) as = "s2";
    else if (pl.includes("inter 2")) as = "s3";
    else if (pl.includes("inter 3")) as = "s4";
    r._activeSec = as;
  });

  /* Best lap from table[2] */
  let bestLap = null;
  if (tables[2]) {
    const m = (tables[2].textContent || "").match(
      /Best lap.*?#(\d+)\s+(.+?)\s+Time:([\d:.]+)(?:\s+in lap\s+(\d+))?/i,
    );
    if (m)
      bestLap = { num: m[1], name: m[2].trim(), time: m[3], lap: m[4] || "" };
  }

  return { meta, riders, bestSecTimes, bestLap };
}

/* ═══════════════════════════════════════════════
   6. RENDER
═══════════════════════════════════════════════ */
function render(riders, bst, bestLap, renderSnap) {
  const tbody = document.getElementById("tbody");
  const tplRow = document.getElementById("tpl-row");
  const tplBst = document.getElementById("tpl-bst");

  if (!tplRow || !tplBst) {
    lg("RENDER", "❌ Templates manquants — index.html non mis à jour");
    return;
  }
  const frag = document.createDocumentFragment();

  riders.forEach((r) => {
    const prev = renderSnap[r.nr] || {};
    const changed = prev.pos !== r.pos || prev.ll !== r.ll1;
    prevRender[r.nr] = {
      pos: r.pos,
      ll: r.ll1,
      posCls: renderSnap[r.nr]?.posCls || "",
    };

    const isLeader = r.pos === 1;
    const ll1IsBest = r.ob && r.ll1 && r.best && r.ll1 === r.best;
    const ll1Cls = ll1IsBest ? "ll-purple" : llClass(r.ll1c);
    const finCls =
      sessionFinished && (r.pass || "").toLowerCase().includes("finish")
        ? "finish"
        : "";

    const posCls = prev.posCls || "";

    const startPos = riderStartPos[r.nr] || r.pos;
    const delta = startPos - r.pos;
    const deltaTxt =
      delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : "—";
    const deltaCls = delta > 0 ? "dt-up" : delta < 0 ? "dt-down" : "dt-same";

    const bikeStyle = getBikeStyle(r.bike);

    /* ── Clone template ── */
    const rowFrag = tplRow.content.cloneNode(true);
    const rowEl = rowFrag.querySelector(".row");

    rowEl.setAttribute("data-rider-nr", r.nr);

    /* Apply bike brand colors to row (used by nr-badge AND c-bike) */
    if (bikeStyle) {
      rowEl.style.setProperty("--nr-bg", bikeStyle.bg);
      rowEl.style.setProperty("--nr-fg", bikeStyle.fg);
    }

    rowEl.className = [
      "row",
      `p${r.pos}`,
      isLeader ? "leader" : "",
      changed ? "flash" : "",
    ]
      .filter(Boolean)
      .join(" ");

    /* Pos */
    const posEl = rowFrag.querySelector(".c-pos");
    posEl.className = `cell c c-pos${posCls ? " " + posCls : ""}`;
    posEl.textContent = r.pos;

    /* Nr badge */
    const badge = rowFrag.querySelector(".nr-badge");
    badge.textContent = r.nr || "?";

    /* Leader du championnat → ajouter border blanc au badge */
    const champNr =
      typeof GP !== "undefined" && GP.getChampLeader
        ? GP.getChampLeader(currentCat)
        : null;
    if (champNr && String(r.nr) === champNr) {
      badge.classList.add("champ-leader");
    }

    /* Rider */
    rowFrag.querySelector(".rider-fn").textContent = r.fn.toUpperCase();
    rowFrag.querySelector(".rider-ln").textContent = r.ln.toUpperCase();

    /* Nation */
    rowFrag.querySelector(".c-nat").appendChild(getNatFlag(r.nation));

    /* Bike */
    const bikeEl = rowFrag.querySelector(".c-bike");
    bikeEl.textContent = r.bike;
    if (bikeStyle) {
      bikeEl.style.color = bikeStyle.bg;
    }

    /* Time */
    rowFrag.querySelector(".c-time").textContent = r.time || "—";

    /* Laps */
    rowFrag.querySelector(".c-laps").textContent = r.laps || "—";

    /* Diff First */
    const dfEl = rowFrag.querySelector(".c-df");
    if (isLeader) {
      dfEl.classList.add("leader-val");
      dfEl.textContent = "LEADER";
    } else {
      dfEl.textContent = r.df || "—";
    }

    /* Diff Prev */
    const dpEl = rowFrag.querySelector(".c-dp");
    dpEl.className = `cell c c-dp ${dpClass(r.dpc)}`;
    dpEl.textContent = r.dp || "—";

    /* Best lap */
    const bestEl = rowFrag.querySelector(".c-best");
    if (r.ob) bestEl.classList.add("ob");
    bestEl.textContent = r.best || "—";

    /* In lap */
    rowFrag.querySelector(".c-inlap").textContent = r.inlap || "—";

    /* Last laps */
    const ll1El = rowFrag.querySelector("[data-ll='1']");
    ll1El.className = `cell c c-ll ${ll1Cls}`;
    ll1El.textContent = r.ll1 || "—";

    const ll2El = rowFrag.querySelector("[data-ll='2']");
    ll2El.className = `cell c c-ll ${llClass(r.ll2c)}`;
    ll2El.textContent = r.ll2 || "—";

    const ll3El = rowFrag.querySelector("[data-ll='3']");
    ll3El.className = `cell c c-ll ${llClass(r.ll3c)}`;
    ll3El.textContent = r.ll3 || "—";

    /* Sectors */
    [
      ["s1", r.s1, r.s1st],
      ["s2", r.s2, r.s2st],
      ["s3", r.s3, r.s3st],
      ["s4", r.s4, r.s4st],
    ].forEach(([key, val, st]) => {
      const el = rowFrag.querySelector(`[data-sec="${key}"]`);
      el.className = [
        "cell c c-sec",
        st || "sec-none",
        r._activeSec === key ? "sec-active" : "",
      ]
        .filter(Boolean)
        .join(" ");
      el.textContent = val || "—";
    });

    /* Delta */
    const deltaEl = rowFrag.querySelector(".c-delta");
    deltaEl.className = `cell c c-delta ${deltaCls}`;
    deltaEl.textContent = deltaTxt;

    /* Status */
    const passEl = rowFrag.querySelector(".c-pass");
    if (finCls) passEl.classList.add(finCls);
    passEl.textContent = r.pass || "—";

    /* Click → Mode Duel (duel.js) */
    rowEl.addEventListener("click", () => {
      if (typeof Duel !== "undefined") Duel.toggle(String(r.nr));
    });

    frag.appendChild(rowFrag);
  });

  /* Best section times footer row */
  if (bst) {
    const bstFrag = tplBst.content.cloneNode(true);
    bstFrag.querySelector(".bst-label").textContent =
      bst.label || "BEST SECTION TIMES";
    [
      ["s1", bst.s1, bst.s1c],
      ["s2", bst.s2, bst.s2c],
      ["s3", bst.s3, bst.s3c],
      ["s4", bst.s4, bst.s4c],
    ].forEach(([key, val, c]) => {
      const el = bstFrag.querySelector(`[data-sec="${key}"]`);
      if (c === "ff00ff") el.classList.add("magenta");
      el.textContent = val || "—";
    });
    frag.appendChild(bstFrag);
  }

  /* Sauvegarder le scroll horizontal AVANT la mutation DOM (iOS WebKit) */
  const _tblWrap = document.getElementById("tbl-wrap");
  const _savedTblLeft = _tblWrap?.scrollLeft ?? 0;

  tbody.innerHTML = "";
  tbody.appendChild(frag);

  /* iOS WebKit reset le scrollLeft du conteneur lors de mutations DOM.
     On sauvegarde/restaure autour de la mutation pour éviter ça. */
  if (_tblWrap && _savedTblLeft > 0) {
    _tblWrap.scrollLeft = _savedTblLeft;
    requestAnimationFrame(() => {
      _tblWrap.scrollLeft = _savedTblLeft;
    });
  }

  /* Reapply duel selection highlights after DOM re-render */
  if (typeof Duel !== "undefined") Duel.applyHighlights();

  /* Best lap banner */
  if (bestLap) {
    document.getElementById("bl-num").textContent = "#" + bestLap.num;
    document.getElementById("bl-name").textContent = bestLap.name;
    document.getElementById("bl-time").textContent = bestLap.time;
    document.getElementById("bl-lap").textContent = bestLap.lap
      ? "in lap " + bestLap.lap
      : "";
    document.getElementById("bl-bar").classList.add("show");
  }
}

/* ═══════════════════════════════════════════════
   7. TICKER
═══════════════════════════════════════════════ */
function buildTicker(riders, meta) {
  if (!riders.length) return;
  const lead = riders[0];
  const fast = riders.find((r) => r.ob) || lead;

  /* Helpers */
  const ti = (...parts) => {
    const s = document.createElement("span");
    s.className = "ti";
    parts.forEach((p) =>
      s.appendChild(typeof p === "string" ? document.createTextNode(p) : p),
    );
    return s;
  };
  const sp = (cls, txt) => {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = txt;
    return s;
  };
  const strong = (txt) => {
    const s = document.createElement("strong");
    s.textContent = txt;
    return s;
  };
  const sep = () => {
    const s = document.createElement("span");
    s.className = "t-sep";
    s.textContent = "◆";
    return s;
  };

  const items = [
    ti(
      "🏁 ",
      sp("ty", "LEADER"),
      " ",
      strong(`#${lead.nr} ${lead.fn} ${lead.ln}`),
      ` — ${lead.time} — `,
      sp("tg", lead.best),
    ),
    ti("🟣 FASTEST LAP ", sp("tp", `#${fast.nr} ${fast.ln} — ${fast.best}`)),
    ...riders
      .slice(0, 8)
      .map((r) =>
        ti(
          `P${r.pos} `,
          strong(`#${r.nr} ${r.ln}`),
          ` ${r.df ? "+" + r.df : "LEADER"} | best:${r.best}`,
        ),
      ),
    ti(
      `📡 ${meta.category || ""} ${meta.sessType || ""} · liveresults.mxgp.com · ${msgCount} msgs`,
    ),
  ];

  const tInner = document.getElementById("t-inner");
  tInner.innerHTML = "";
  const frag = document.createDocumentFragment();
  /* Double the items for seamless infinite scroll */
  [...items, ...items.map((el) => el.cloneNode(true))].forEach(
    (item, i, arr) => {
      frag.appendChild(item);
      if (i < arr.length - 1) frag.appendChild(sep());
    },
  );
  tInner.appendChild(frag);
}

/* ═══════════════════════════════════════════════
   DELAY UI
═══════════════════════════════════════════════ */
function initDelayUI() {
  const btn = document.getElementById("delay-btn");
  const panel = document.getElementById("delay-panel");
  const input = document.getElementById("delay-input");
  const apply = document.getElementById("delay-apply");
  const btnVal = document.getElementById("delay-btn-val");
  const status = document.getElementById("delay-status");
  const presets = document.querySelectorAll(".delay-preset");

  /* Valeur cible et compteur montant affiche sur le bouton */
  let delayTarget = 0;
  let delayRampVal = 0;
  let delayRampTimer = null;

  function updateCountdown() {
    if (delayCountdown > 0) {
      status.innerHTML = `<span class="delay-spinner"></span>Setting up: <strong>${delayCountdown}s</strong>`;
      delayCountdown--;
    } else {
      if (delayCountdownTimer) clearInterval(delayCountdownTimer);
      delayCountdownTimer = null;
      status.innerHTML = `Active delay — ${delayTarget}s ✓`;
      status.classList.remove("on");
    }
  }

  /* Monte le label bouton de 0 vers target, 1s par tick */
  function startRamp(target) {
    if (delayRampTimer) clearInterval(delayRampTimer);
    delayRampVal = 0;
    btnVal.textContent = "0s";
    if (target === 0) return;
    delayRampTimer = setInterval(() => {
      delayRampVal = Math.min(delayRampVal + 1, target);
      btnVal.textContent = delayRampVal + "s";
      if (delayRampVal >= target) {
        clearInterval(delayRampTimer);
        delayRampTimer = null;
      }
    }, 1000);
  }

  function applyDelay(sec) {
    delayMs = sec * 1000;
    delayTarget = sec;
    /* flush messages already past due when reducing delay */
    const now = Date.now();
    while (msgQueue.length && now - msgQueue[0].receivedAt >= delayMs) {
      onMsg(msgQueue.shift().data);
    }

    input.value = sec;

    /* Bouton : monte de 0 vers sec, ou remet a 0 */
    if (sec === 0) {
      if (delayRampTimer) {
        clearInterval(delayRampTimer);
        delayRampTimer = null;
      }
      btnVal.textContent = "0s";
    } else {
      startRamp(sec);
    }

    /* Presets active state */
    presets.forEach((p) => {
      p.classList.toggle("active", +p.dataset.s === sec);
    });

    /* Button active state */
    btn.classList.toggle("active", sec > 0);

    /* Status dans le panel */
    if (sec === 0) {
      if (delayCountdownTimer) clearInterval(delayCountdownTimer);
      delayCountdownTimer = null;
      delayCountdown = 0;
      status.textContent = "No active delay";
      status.classList.remove("on");
    } else {
      if (delayCountdownTimer) clearInterval(delayCountdownTimer);
      delayCountdown = sec;
      updateCountdown();
      delayCountdownTimer = setInterval(updateCountdown, 1000);
      status.classList.add("on");
    }

    /* Close panel */
    panel.hidden = true;
  }

  /* Toggle panel */
  btn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });

  /* Close panel on click outside */
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) {
      panel.hidden = true;
    }
  });

  /* Preset buttons */
  presets.forEach((p) => {
    p.addEventListener("click", () => {
      applyDelay(+p.dataset.s);
    });
  });

  /* Custom input */
  apply.addEventListener("click", () => {
    const v = Math.max(0, Math.min(300, parseInt(input.value) || 0));
    applyDelay(v);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") apply.click();
  });
}

/* ═══════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════ */
initDelayUI();
negotiate();
