/* ═══════════════════════════════════════════════════════════
   MXGP Live Timing — settings.js  v1.0
   Panneau réglages : visibilité des colonnes du live timing.

   Fonctionnement :
     • Chaque colonne a une clé (data-col) sur les .ch et .cell
     • Quand une colonne est masquée, on :
         1. Ajoute une règle CSS display:none sur [data-col="xxx"]
         2. Reconstruit --gc (grid-template-columns) sans cette colonne
         3. Recalcule --tbl-min
     • Persistance localStorage (clé "mxgp_col_vis_v2")

   API (window.Settings) :
     Settings.init()              — auto-appelé au chargement
     Settings.getBstLabelSpan()   — nb colonnes visibles avant S1 (pour bst-row)
═══════════════════════════════════════════════════════════ */

const Settings = (() => {
  /* ─── Colonnes ——————————————————————————————————————────
     key    : valeur data-col sur .ch et .cell
     label  : affiché dans le panneau
     size   : taille dans --gc  (minmax(min, auto) = adapte au contenu)
     min    : minimum px pour --tbl-min
  ─────────────────────────────────────────────────────────── */
  /* Tailles fixes en px → thead et rows partagent les MÊMES tracks,
     garantissant l'alignement parfait entre les deux grids séparés.
     Seul Rider utilise fr (expansion) avec un min large pour ne jamais
     rétrécir sous le nom le plus long (~180px couvre tous les riders MXGP). */
  const COLS = [
    { key: "pos", label: "Pos", size: "50px", min: 50 },
    { key: "nr", label: "Nr", size: "72px", min: 72 },
    { key: "rider", label: "Rider", size: "minmax(180px,1.8fr)", min: 180 },
    { key: "nat", label: "Nat", size: "72px", min: 72 },
    { key: "bike", label: "Bike", size: "76px", min: 76 },
    { key: "time", label: "Time", size: "96px", min: 96 },
    { key: "laps", label: "Laps", size: "48px", min: 48 },
    { key: "df", label: "Diff.First", size: "96px", min: 96 },
    { key: "dp", label: "Diff.Prv", size: "96px", min: 96 },
    { key: "best", label: "Best Lap", size: "96px", min: 96 },
    { key: "inlap", label: "In Lap", size: "48px", min: 48 },
    { key: "ll1", label: "Last Lap", size: "96px", min: 96 },
    { key: "ll2", label: "Last Lap 2", size: "96px", min: 96 },
    { key: "ll3", label: "Last Lap 3", size: "96px", min: 96 },
    { key: "s1", label: "S1", size: "82px", min: 82 },
    { key: "s2", label: "S2", size: "82px", min: 82 },
    { key: "s3", label: "S3", size: "82px", min: 82 },
    { key: "s4", label: "S4", size: "82px", min: 82 },
    { key: "delta", label: "Delta", size: "48px", min: 48 },
    { key: "status", label: "Status", size: "78px", min: 78 },
  ];

  const LS_KEY = "mxgp_col_vis_v2";
  const hidden = new Set(); // clés des colonnes masquées
  let _styleEl = null; // <style id="col-vis-style">
  let panel = null;
  let btn = null;

  /* ════════════════════════════════════════
     PERSISTANCE
  ════════════════════════════════════════ */
  function _load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (Array.isArray(obj.hidden)) obj.hidden.forEach((k) => hidden.add(k));
    } catch (e) {}
  }

  function _save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ hidden: [...hidden] }));
    } catch (e) {}
  }

  /* ════════════════════════════════════════
     REBUILD — --gc + règles CSS
  ════════════════════════════════════════ */
  function _styleTag() {
    if (!_styleEl) {
      _styleEl = document.createElement("style");
      _styleEl.id = "col-vis-style";
      document.head.appendChild(_styleEl);
    }
    return _styleEl;
  }

  function _rebuild() {
    const vis = COLS.filter((c) => !hidden.has(c.key));

    /* Nouveau --gc : seulement les colonnes visibles */
    const gc = vis.map((c) => c.size).join(" ");
    const tblMin = vis.reduce((s, c) => s + c.min, 0);

    document.documentElement.style.setProperty("--gc", gc);
    document.documentElement.style.setProperty("--tbl-min", tblMin + "px");

    /* Règles CSS display par colonne
       Les !important écrasent les nth-child des media queries existantes */
    let rules = "";
    COLS.forEach((c) => {
      const sel = `.ch[data-col="${c.key}"], .cell[data-col="${c.key}"]`;
      if (hidden.has(c.key)) {
        rules += `${sel}{display:none!important}\n`;
      } else {
        rules += `.ch[data-col="${c.key}"]{display:block!important}\n`;
        rules += `.cell[data-col="${c.key}"]{display:flex!important}\n`;
      }
    });
    _styleTag().textContent = rules;

    /* Indicateur sur le bouton */
    if (btn) btn.classList.toggle("sett-has-hidden", hidden.size > 0);

    /* Mettre à jour le span du label bst-row si déjà dans le DOM */
    _fixBstLabels();
  }

  /* Calcule le nb de colonnes visibles AVANT s1 → span pour bst-label */
  function getBstLabelSpan() {
    const s1Idx = COLS.findIndex((c) => c.key === "s1");
    return Math.max(
      1,
      COLS.slice(0, s1Idx).filter((c) => !hidden.has(c.key)).length,
    );
  }

  function _fixBstLabels() {
    const span = getBstLabelSpan();
    document.querySelectorAll(".bst-label").forEach((el) => {
      el.style.gridColumn = "span " + span;
    });
  }

  /* ════════════════════════════════════════
     PANEL — construction
  ════════════════════════════════════════ */
  function _buildPanel() {
    panel = document.createElement("div");
    panel.className = "sett-panel";
    panel.id = "sett-panel";
    panel.setAttribute("hidden", "");

    panel.innerHTML =
      '<div class="sett-hdr">' +
      '<span class="sett-ttl">⚙\u2004COLUMNS</span>' +
      '<button class="sett-reset" id="sett-reset" title="Show all">↺ Reset</button>' +
      '<button class="sett-close" id="sett-close" title="Close">✕</button>' +
      "</div>" +
      '<div class="sett-grid" id="sett-grid"></div>';

    document.body.appendChild(panel);

    /* Checkboxes */
    const grid = panel.querySelector("#sett-grid");
    COLS.forEach((col) => {
      const lbl = document.createElement("label");
      lbl.className = "sett-item";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "sett-chk";
      chk.dataset.col = col.key;
      chk.checked = !hidden.has(col.key);

      const span = document.createElement("span");
      span.className = "sett-lbl";
      span.textContent = col.label;

      lbl.appendChild(chk);
      lbl.appendChild(span);
      grid.appendChild(lbl);

      chk.addEventListener("change", () => {
        if (chk.checked) hidden.delete(col.key);
        else hidden.add(col.key);
        _save();
        _rebuild();
      });
    });

    /* Reset */
    panel.querySelector("#sett-reset").addEventListener("click", () => {
      hidden.clear();
      localStorage.removeItem(LS_KEY);
      _rebuild();
      panel.querySelectorAll(".sett-chk").forEach((c) => (c.checked = true));
    });

    /* Fermer */
    panel.querySelector("#sett-close").addEventListener("click", _close);

    /* Clic extérieur */
    document.addEventListener("click", (e) => {
      if (
        !panel.hasAttribute("hidden") &&
        !panel.contains(e.target) &&
        e.target !== btn &&
        !btn.contains(e.target)
      ) {
        _close();
      }
    });

    /* Échap */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") _close();
    });
  }

  /* ════════════════════════════════════════
     BOUTON ENGRENAGE
  ════════════════════════════════════════ */
  function _buildBtn() {
    btn = document.createElement("button");
    btn.className = "sett-btn";
    btn.id = "sett-btn";
    btn.title = "Column settings";
    btn.innerHTML = '<span class="sett-icon">⚙</span>';
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.hasAttribute("hidden") ? _open() : _close();
    });

    /* Insérer dans .hdr-right, juste avant le version-badge */
    const hdrRight = document.querySelector(".hdr-right");
    if (hdrRight) hdrRight.insertBefore(btn, hdrRight.firstChild);
  }

  /* ════════════════════════════════════════
     OUVERTURE / FERMETURE
  ════════════════════════════════════════ */
  function _open() {
    panel.removeAttribute("hidden");
    btn.classList.add("sett-btn-active");

    /* Positionner sous le bouton, ancré à droite */
    const r = btn.getBoundingClientRect();
    panel.style.top = r.bottom + 6 + "px";
    panel.style.right = Math.max(4, window.innerWidth - r.right) + "px";
    panel.style.left = "auto";

    /* Recadrer si déborde à gauche */
    requestAnimationFrame(() => {
      const pr = panel.getBoundingClientRect();
      if (pr.left < 6) {
        panel.style.right = "auto";
        panel.style.left = "6px";
      }
    });
  }

  function _close() {
    panel.setAttribute("hidden", "");
    btn.classList.remove("sett-btn-active");
  }

  /* ════════════════════════════════════════
     INIT — point d'entrée public
  ════════════════════════════════════════ */
  function init() {
    _load();
    _buildBtn();
    _buildPanel();
    _rebuild(); // Settings.js prend le contrôle de --gc dès l'init
  }

  return { init, getBstLabelSpan, fixBstLabels: _fixBstLabels };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Settings.init());
} else {
  Settings.init();
}
