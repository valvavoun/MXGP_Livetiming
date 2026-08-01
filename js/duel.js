/* ═══════════════════════════════════════════════
   MXGP Live Timing — duel.js
   Mode Duel : sélection par clic, comparaison
   sectorielle. Couleur = couleur moto du pilote.

   API (window.Duel) :
     Duel.toggle(nr)        — clic sur une ligne
     Duel.update(riders)    — appelé par main.js à chaque render
     Duel.applyHighlights() — recolorise les rows après re-render
     Duel.clearAll()        — Échap ou bouton ✕
═══════════════════════════════════════════════ */

const Duel = (() => {
  /* ─────────────────────────────────────────────
     CONFIG
  ───────────────────────────────────────────── */
  const MAX = 8;
  const FALLBACK_COLORS = ["#888", "#aaa", "#bbb", "#ccc"];

  /**
   * Seules les métriques qui répondent à la question :
   * "qui est le plus rapide, sur quelle partie ?"
   */
  const METRICS = [
    {
      label: "Best",
      fmt: (r) => r.best || "—",
      time: true,
      sector: false,
      key: null,
    },
    {
      label: "Last",
      fmt: (r) => r.ll1 || "—",
      time: true,
      sector: false,
      key: null,
    },
    {
      label: "S1",
      fmt: (r) => r.s1 || "—",
      time: true,
      sector: true,
      key: "s1",
    },
    {
      label: "S2",
      fmt: (r) => r.s2 || "—",
      time: true,
      sector: true,
      key: "s2",
    },
    {
      label: "S3",
      fmt: (r) => r.s3 || "—",
      time: true,
      sector: true,
      key: "s3",
    },
    {
      label: "S4",
      fmt: (r) => r.s4 || "—",
      time: true,
      sector: true,
      key: "s4",
    },
  ];

  /* ─────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────── */
  let selected = []; // nr strings dans l'ordre de sélection
  let latestRiders = []; // snapshot reçu de main.js
  let panel = null;

  /* ─────────────────────────────────────────────
     COULEUR MOTO — réutilise getBikeStyle de main.js
  ───────────────────────────────────────────── */
  function _bikeColor(nr) {
    const r = latestRiders.find((x) => String(x.nr) === String(nr));
    if (!r) return FALLBACK_COLORS[selected.indexOf(String(nr)) % 4];
    const style =
      typeof getBikeStyle === "function" ? getBikeStyle(r.bike) : null;
    return style ? style.bg : FALLBACK_COLORS[selected.indexOf(String(nr)) % 4];
  }

  /* ─────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────── */
  function init() {
    _buildPanel();
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") clearAll();
    });
  }

  /* ─────────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────────── */

  function update(riders) {
    latestRiders = riders || [];
    if (selected.length >= 2) _renderPanel();
  }

  function toggle(nr) {
    nr = String(nr);
    const i = selected.indexOf(nr);
    if (i !== -1) {
      selected.splice(i, 1);
    } else {
      if (selected.length >= MAX) selected.shift();
      selected.push(nr);
    }
    _applyRowHighlights();
    _syncVisibility();
    if (selected.length >= 2) _renderPanel();
  }

  function applyHighlights() {
    _applyRowHighlights();
  }

  function clearAll() {
    selected = [];
    _applyRowHighlights();
    _syncVisibility();
  }

  /* ─────────────────────────────────────────────
     INTERNAL
  ───────────────────────────────────────────── */

  function _syncVisibility() {
    const on = selected.length >= 2;
    panel.classList.toggle("duel-visible", on);
    document.body.classList.toggle("duel-active", on);
  }

  function _applyRowHighlights() {
    /* Retirer toutes les marques duel */
    document.querySelectorAll(".row[data-rider-nr]").forEach((el) => {
      el.classList.remove("duel-selected");
      el.style.removeProperty("--duel-rider-c");
    });
    /* Appliquer couleur moto sur chaque row sélectionné */
    selected.forEach((nr) => {
      const el = document.querySelector(`[data-rider-nr="${nr}"]`);
      if (!el) return;
      el.classList.add("duel-selected");
      el.style.setProperty("--duel-rider-c", _bikeColor(nr));
    });
  }

  function _buildPanel() {
    panel = document.createElement("div");
    panel.className = "duel-panel";
    panel.innerHTML =
      '<div class="duel-header">' +
      '<div class="duel-title">' +
      "</div>" +
      '<button class="duel-close" id="duel-close" title="Fermer">✕</button>' +
      "</div>" +
      '<div class="duel-body" id="duel-body"></div>';
    document.body.appendChild(panel);
    document.getElementById("duel-close").addEventListener("click", clearAll);
  }

  /* ─────────────────────────────────────────────
     ÉCART ENTRE PILOTES SÉLECTIONNÉS
  ───────────────────────────────────────────── */

  /** Parse r.df → secondes depuis le leader (null si inconnue / lappé) */
  function _parseDf(r) {
    if (!r) return null;
    if (!r.df || r.df === "—") return r.pos === 1 ? 0 : null; // leader = 0
    const s = String(r.df).trim();
    if (/lap/i.test(s)) return null; // lappé → non comparable
    const m = s.match(/(\d+):(\d{2})\.(\d{1,3})/);
    if (m) return +m[1] * 60 + +m[2] + +m[3].padEnd(3, "0") / 1000;
    const n = parseFloat(s.replace(",", "."));
    return isNaN(n) ? null : n;
  }

  /** Construit la ligne d'écart proéminente entre les riders sélectionnés */
  function _buildGapSection(riders, body) {
    // Pour chaque paire consécutive (par position dans la course)
    const sorted = [...riders].sort((a, b) => (a.pos || 99) - (b.pos || 99));
    const dfs = sorted.map((r) => _parseDf(r));

    const sec = _el("div", "duel-gap-section");

    for (let i = 0; i < sorted.length - 1; i++) {
      const ahead = sorted[i];
      const behind = sorted[i + 1];
      const dA = dfs[i];
      const dB = dfs[i + 1];

      const block = _el("div", "duel-gap-block");

      // Couleurs des deux pilotes
      const cA = _bikeColor(ahead.nr);
      const cB = _bikeColor(behind.nr);

      // Noms courts
      const nameA = _esc(
        (ahead.ln || ahead.fn || "#" + ahead.nr).toUpperCase(),
      );
      const nameB = _esc(
        (behind.ln || behind.fn || "#" + behind.nr).toUpperCase(),
      );

      if (dA !== null && dB !== null) {
        const gap = dB - dA; // toujours ≥ 0 car sorted par pos
        const gapStr = gap < 0.001 ? "0.000" : "+" + gap.toFixed(3) + "s";
        const gapClass = gap < 1 ? " duel-gap-close" : "";

        block.innerHTML =
          `<div class="duel-gap-riders">` +
          `<span class="duel-gap-name" style="color:${cA}">${nameA}</span>` +
          `<span class="duel-gap-arrow">▶</span>` +
          `<span class="duel-gap-name" style="color:${cB}">${nameB}</span>` +
          `</div>` +
          `<div class="duel-gap-val${gapClass}">${gapStr}</div>`;
      } else {
        // Écart indisponible (lappé ou pas encore de données)
        block.innerHTML =
          `<div class="duel-gap-riders">` +
          `<span class="duel-gap-name" style="color:${cA}">${nameA}</span>` +
          `<span class="duel-gap-arrow">▶</span>` +
          `<span class="duel-gap-name" style="color:${cB}">${nameB}</span>` +
          `</div>` +
          `<div class="duel-gap-val duel-gap-na">—</div>`;
      }

      sec.appendChild(block);
    }

    body.appendChild(sec);
  }

  function _renderPanel() {
    /* Résoudre les riders dans l'ordre de sélection */
    const riders = selected
      .map((nr) => latestRiders.find((r) => String(r.nr) === nr))
      .filter(Boolean);
    if (riders.length < 2) return;

    const body = document.getElementById("duel-body");
    body.innerHTML = "";

    /* ── En-tête pilotes ── */
    const hdr = _el("div", "duel-riders-hdr");
    hdr.appendChild(_el("div", "duel-lbl")); /* colonne label vide */

    riders.forEach((r) => {
      const c = _bikeColor(r.nr);
      const cell = _el("div", "duel-rider-hdr");
      cell.style.setProperty("--duel-c", c);
      cell.innerHTML =
        `<span class="duel-nr">#${r.nr}</span>` +
        `<span class="duel-name">${_esc(r.ln || r.fn || "")}</span>` +
        `<span class="duel-bike">${_esc(r.bike || "")}</span>`;
      hdr.appendChild(cell);
    });
    body.appendChild(hdr);

    /* ── Écart entre pilotes ── */
    _buildGapSection(riders, body);

    /* ── Lignes métriques ── */
    METRICS.forEach((metric) => {
      /* N'afficher S4 que si au moins un rider a une valeur */
      if (metric.label === "S4") {
        const hasS4 = riders.some((r) => r.s4 && r.s4 !== "—");
        if (!hasS4) return;
      }

      const vals = riders.map((r) => metric.fmt(r));
      const times = metric.time ? vals.map((v) => _parseTime(v)) : [];

      /* Index du plus rapide (temps valide le plus bas) */
      let bestIdx = -1;
      if (metric.time) {
        const valid = times.filter((t) => t !== null);
        if (valid.length >= 2) {
          const minT = Math.min(...valid);
          bestIdx = times.findIndex((t) => t === minT);
        }
      }

      const row = _el("div", "duel-row");

      /* Label */
      const lbl = _el("div", "duel-lbl");
      lbl.textContent = metric.label;
      if (metric.sector) lbl.classList.add("duel-lbl-sec");
      row.appendChild(lbl);

      /* Cellules */
      vals.forEach((val, i) => {
        const c = _bikeColor(riders[i].nr);
        const isActive = !!(metric.key && riders[i]._activeSec === metric.key);
        const cell = _el("div", "duel-cell");
        cell.style.setProperty("--duel-c", c);
        if (i === bestIdx) cell.classList.add("duel-best");
        if (isActive) cell.classList.add("duel-cell-active");

        const valEl = _el("span", "duel-val");
        valEl.textContent = val;
        cell.appendChild(valEl);

        /* Écart affiché sur le plus rapide */
        if (metric.time && bestIdx !== -1 && i === bestIdx) {
          const others = times.filter(
            (t, idx) => idx !== bestIdx && t !== null,
          );

          if (others.length) {
            const slowest = Math.max(...others);
            const diff = _el("span", "duel-diff");
            diff.textContent = "-" + (slowest - times[bestIdx]).toFixed(3);
            cell.appendChild(diff);
          }
        }

        row.appendChild(cell);
      });

      body.appendChild(row);
    });

    /* ── Résumé avantage secteurs ── */
    const secMetrics = METRICS.filter((m) => m.sector);
    if (secMetrics.length) {
      const adv = riders.map(() => 0);
      secMetrics.forEach((metric) => {
        const times = riders.map((r) => _parseTime(metric.fmt(r)));
        const valid = times.filter((t) => t !== null);
        if (valid.length < 2) return;
        const minT = Math.min(...valid);
        const idx = times.findIndex((t) => t === minT);
        if (idx !== -1) adv[idx]++;
      });

      const maxAdv = Math.max(...adv);
      const sumRow = _el("div", "duel-row duel-sum-row");
      const sumLbl = _el("div", "duel-lbl");
      sumLbl.textContent = "";
      sumRow.appendChild(sumLbl);

      riders.forEach((r, i) => {
        const c = _bikeColor(r.nr);
        const cell = _el("div", "duel-cell duel-adv");
        cell.style.setProperty("--duel-c", c);
        if (adv[i] === maxAdv && maxAdv > 0) cell.classList.add("duel-best");
        const valEl = _el("span", "duel-val");
        valEl.textContent = `${adv[i]} / ${
          secMetrics.filter((m) => {
            if (m.label !== "S4") return true;
            return riders.some((r) => r.s4 && r.s4 !== "—");
          }).length
        }`;
        cell.appendChild(valEl);
        sumRow.appendChild(cell);
      });

      body.appendChild(sumRow);
    }
  }

  /* ─────────────────────────────────────────────
     UTILS
  ───────────────────────────────────────────── */

  function _parseTime(str) {
    if (!str || str === "—") return null;
    const s = String(str).trim();
    let m;
    m = s.match(/^(\d+):(\d{2})\.(\d{1,3})$/);
    if (m) return +m[1] * 60 + +m[2] + +m[3].padEnd(3, "0") / 1000;
    m = s.match(/^(\d{1,3})\.(\d{1,3})$/);
    if (m) return +m[1] + +m[2].padEnd(3, "0") / 1000;
    return null;
  }

  function _el(tag, cls) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  function _esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  return { init, update, toggle, applyHighlights, clearAll };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Duel.init());
} else {
  Duel.init();
}
