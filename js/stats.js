/* ═══════════════════════════════════════════════════════════
   MXGP Live Timing — stats.js  v1.1
   Module statistiques saison — extrait de gp.js.

   Dépendance : chargé APRÈS gp.js dans index.html.

   API (window.Stats) :
     Stats.render(body, ctx)   — rendu complet de la vue stats
     Stats.resetSort()         — remet le tri par défaut (racewins)
═══════════════════════════════════════════════════════════ */

const Stats = (() => {
  const RACE_ORDER = ["QR", "R1", "R2"];

  let _sort = "racewins";
  let _ctx = null;
  let _body = null;

  /* ─────────────────────────────────────────────────────────
     SCROLL PRESERVATION
  ───────────────────────────────────────────────────────── */
  function _withScrollPreservation(fn) {
    // Lire avant fn() — l'élément est encore dans le DOM.
    // querySelectorAll (pas querySelector) — couvre toutes les tables
    // scrollables affichées, pas uniquement la première.
    const wraps = _body ? [..._body.querySelectorAll(".gp-table-wrap")] : [];
    const savedLefts = wraps.map((w) => w.scrollLeft);
    const savedTop  = _body?.scrollTop ?? 0;

    fn();

    // _body n'est pas remplacé → scrollTop direct OK
    if (_body) _body.scrollTop = savedTop;

    // .gp-table-wrap recréé via innerHTML → requête fraîche dans double RAF
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (_body) _body.scrollTop = savedTop;
        const newWraps = _body ? [..._body.querySelectorAll(".gp-table-wrap")] : [];
        newWraps.forEach((w, i) => {
          if (savedLefts[i] > 0) w.scrollLeft = savedLefts[i];
        });
      });
    });
  }

  /* ─────────────────────────────────────────────────────────
     API PUBLIQUE
  ───────────────────────────────────────────────────────── */

  function resetSort() {
    _sort = "racewins";
  }

  function render(body, ctx) {
    _body = body;
    _ctx = ctx;
    _doRender();
  }

  /* ─────────────────────────────────────────────────────────
     RENDU INTERNE
  ───────────────────────────────────────────────────────── */
  function _doRender() {
    const {
      getActiveSeason,
      setActiveSeason,
      getActiveCat,
      getSeasons,
      renderSeasonCatBar,
      esc,
    } = _ctx;

    const seasons = getSeasons();

    let activeSeason = getActiveSeason();
    if (!activeSeason || !seasons.includes(activeSeason)) {
      activeSeason = seasons[0] || "";
      setActiveSeason(activeSeason);
    }

    renderSeasonCatBar(seasons);

    const activeCat = _ctx.getActiveCat();

    if (!getActiveSeason() || !activeCat) {
      _body.innerHTML = `<div class="gp-empty">No data.</div>`;
      return;
    }

    const { rows, hasQR } = _compute(getActiveSeason(), activeCat);

    if (!rows.length) {
      _body.innerHTML = `<div class="gp-empty">No stats for ${esc(activeCat)} ${esc(getActiveSeason())}.</div>`;
      return;
    }

    _withScrollPreservation(() => {
      // ── Tri ──────────────────────────────────────────────
      rows.sort((a, b) => {
        if (_sort === "racewins")
          return b.racewins - a.racewins || b.podiums - a.podiums;
        if (_sort === "podiums")
          return b.podiums - a.podiums || b.racewins - a.racewins;
        if (_sort === "perfectgp")
          return b.perfect - a.perfect || b.racewins - a.racewins;
        if (_sort === "qr")
          return b.qrwins - a.qrwins || b.racewins - a.racewins;
        if (_sort === "avg") return parseFloat(a.avgPos) - parseFloat(b.avgPos);
        if (_sort === "avgpts") return b.avgPts - a.avgPts;
        if (_sort === "gps") return b.gps - a.gps;
        return b.racewins - a.racewins;
      });

      const maxWins = Math.max(...rows.map((r) => r.racewins), 1);

      // ── Hero cards ──────────────────────────────────────
      const topWins = rows[0];
      const topPodiums = [...rows].sort((a, b) => b.podiums - a.podiums)[0];
      const topGC = [...rows].sort((a, b) => b.perfect - a.perfect)[0];
      const topQR = [...rows].sort((a, b) => b.qrwins - a.qrwins)[0];
      const topAvgPos = [...rows]
        .filter((r) => r.gps >= 3)
        .sort((a, b) => parseFloat(a.avgPos) - parseFloat(b.avgPos))[0];
      const topAvgPts = [...rows]
        .filter((r) => r.gps >= 3)
        .sort((a, b) => b.avgPts - a.avgPts)[0];

      const cards = [
        {
          icon: "🥇",
          lbl: "Most Race Wins",
          name: topWins?.ln,
          val: topWins?.racewins,
        },
        {
          icon: "🏆",
          lbl: "Most GP Podiums",
          name: topPodiums?.ln,
          val: topPodiums?.podiums,
        },
        ...(hasQR
          ? [
              {
                icon: "🔥",
                lbl: "Perfect GP",
                name: topGC?.ln,
                val: topGC?.perfect,
                tip: "QR + R1 + R2 wins — same rider same GP",
              },
              {
                icon: "🏁",
                lbl: "QR Victories",
                name: topQR?.ln,
                val: topQR?.qrwins,
              },
            ]
          : []),
        {
          icon: "📈",
          lbl: "Best Avg Position",
          name: topAvgPos?.ln,
          val: topAvgPos ? `P${topAvgPos.avgPos}` : "—",
        },
        {
          icon: "⭐",
          lbl: "Best Avg Pts / GP",
          name: topAvgPts?.ln,
          val: topAvgPts ? `${topAvgPts.avgPts}` : "—",
        },
      ].filter((c) => c.val && c.val !== "—" && c.val !== 0);

      let html = `<div class="gp-stats-cards">`;
      cards.forEach((c) => {
        html += `<div class="gp-stat-card">
        <span class="gp-stat-card-icon">${c.icon}</span>
        <span class="gp-stat-card-lbl">${c.lbl}</span>
        <span class="gp-stat-card-name">${esc(c.name || "")}</span>
        <span class="gp-stat-card-val">${c.val}</span>
      </div>`;
      });
      html += `</div>`;

      // ── Tableau ─────────────────────────────────────────
      const cols = [
        { key: "rank", label: "#", tip: "Rank" },
        { key: "rider", label: "Rider", tip: "Rider" },
        { key: "gps", label: "GPs", tip: "GP weekends entered" },
        { key: "racewins", label: "Wins", tip: "Total Race 1 + Race 2 wins" },
        ...(hasQR
          ? [
              { key: "qr", label: "QR", tip: "Qualifying Race wins" },
              {
                key: "perfectgp",
                label: "Perfect GP",
                tip: "Perfect GP — won QR + R1 + R2 same GP",
              },
            ]
          : []),
        {
          key: "podiums",
          label: "Podiums",
          tip: "GP podiums — top-3 in combined R1+R2 ranking",
        },
        {
          key: "avg",
          label: "Avg P",
          tip: "Average finishing position (all races)",
        },
        {
          key: "avgpts",
          label: "Avg Pts",
          tip: "Average points per GP (QR + R1 + R2)",
        },
      ];

      const sortKeyMap = {
        racewins: "racewins",
        podiums: "podiums",
        perfectgp: "perfectgp",
        qr: "qr",
        avg: "avg",
        avgpts: "avgpts",
        gps: "gps",
      };

      html += `<div class="gp-stats-title">Full Rankings — ${esc(activeCat)} ${esc(getActiveSeason())}</div>`;
      html += `<div class="gp-stats-table-wrap"><table class="gp-stats-table" id="gp-stats-table"><thead><tr>`;

      cols.forEach((c) => {
        const active = sortKeyMap[c.key] === _sort;
        html += `<th data-sort="${c.key}" class="${active ? "gp-sort-active" : ""}" title="${c.tip}">${c.label}</th>`;
      });
      html += `</tr></thead><tbody>`;

      rows.forEach((r, idx) => {
        const pos = idx + 1;
        const posCls = pos <= 3 ? `gp-pos-${pos}` : "";
        const barW = Math.round((r.racewins / maxWins) * 60);

        const winsCell =
          r.racewins > 0
            ? `<div class="gp-win-bar-wrap">
            <span class="gp-sv-wins">${r.racewins}</span>
            <div class="gp-win-bar" style="width:${barW}px"></div>
           </div>`
            : `<span class="gp-sv-zero">0</span>`;

        const podPct = r.gps > 0 ? Math.round((r.podiums / r.gps) * 100) : 0;

        html += `<tr class="${posCls}">
        <td>${pos}</td>
        <td>
          <span class="gp-fn">${esc(r.fn)}</span>
          <span class="gp-ln">${esc(r.ln)}</span>
          <span class="gp-nr">#${r.nr}</span>
        </td>
        <td>${r.gps}</td>
        <td>${winsCell}</td>
        ${
          hasQR
            ? `
        <td>${r.qrwins > 0 ? `<span class="gp-sv-pod">${r.qrwins}</span>` : `<span class="gp-sv-zero">0</span>`}</td>
        <td>${r.perfect > 0 ? `<span class="gp-sv-perf">🔥 ${r.perfect}</span>` : `<span class="gp-sv-zero">0</span>`}</td>
        `
            : ""
        }
        <td>${
          r.podiums > 0
            ? `<span class="gp-sv-pod">${r.podiums}</span><span class="gp-sv-pct"> (${podPct}%)</span>`
            : `<span class="gp-sv-zero">0</span>`
        }</td>
        <td><span class="gp-sv-avg">${r.avgPos}</span></td>
        <td><span class="gp-sv-avg">${r.avgPts}</span></td>
      </tr>`;
      });

      html += `</tbody></table></div>`;
      _body.innerHTML = html;

      _body.querySelectorAll(".gp-stats-table th[data-sort]").forEach((th) => {
        th.addEventListener("click", () => {
          const k = th.dataset.sort;
          if (k === "rank" || k === "rider") return;
          _sort = k;
          _doRender();
        });
      });
    }); // Ferme _withScrollPreservation
  }

  /* ─────────────────────────────────────────────────────────
     CALCUL DES STATISTIQUES
     Retourne { rows, hasQR }
       rows   : tableau de stats par pilote
       hasQR  : true si la catégorie a au moins une manche QR
  ───────────────────────────────────────────────────────── */
  function _compute(year, cat) {
    const { allGPs, sortedWeeks } = _ctx;
    const weeks = sortedWeeks().filter((wk) => wk.startsWith(year));
    const map = {};
    let hasQR = false;

    weeks.forEach((wk) => {
      const races = allGPs[wk]?.cats?.[cat]?.races || {};

      // Détecter si la catégorie a des manches qualif
      if (races.QR?.results?.length) hasQR = true;

      // Perfect GP : même rider gagne QR + R1 + R2
      const qrWinner = (races.QR?.results || []).find((r) => r.pos === 1);
      const r1Winner = (races.R1?.results || []).find((r) => r.pos === 1);
      const r2Winner = (races.R2?.results || []).find((r) => r.pos === 1);
      const perfectNr =
        qrWinner &&
        r1Winner &&
        r2Winner &&
        qrWinner.nr === r1Winner.nr &&
        r1Winner.nr === r2Winner.nr
          ? r1Winner.nr
          : null;

      // ── Classement GP = combiné R1 + R2 (points) ──────────
      // On cumule les pts de chaque pilote sur R1+R2 pour déterminer
      // le podium GP réel (P1/P2/P3 au classement combiné).
      const gpPts = {}; // nr → points cumulés R1+R2
      ["R1", "R2"].forEach((key) => {
        (races[key]?.results || []).forEach((r) => {
          if (!gpPts[r.nr]) gpPts[r.nr] = 0;
          if (typeof r.pts === "number") gpPts[r.nr] += r.pts;
        });
      });
      // Tri décroissant → les 3 premiers sont sur le podium GP
      const gpRanked = Object.keys(gpPts).sort((a, b) => gpPts[b] - gpPts[a]);
      const gpPodiumSet = new Set(gpRanked.slice(0, 3));

      // ── Parcours des manches ───────────────────────────────
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
              racewins: 0,
              qrwins: 0,
              podiums: 0,
              perfect: 0,
              races: 0,
              gps_set: new Set(),
              positions: [],
              totalPts: 0,
            };
          const d = map[r.nr];
          d.races++;
          d.gps_set.add(wk);
          if (r.pos > 0) d.positions.push(r.pos);
          // Points pour avg pts (QR + R1 + R2)
          if (typeof r.pts === "number") d.totalPts += r.pts;
          if (r.pos === 1) {
            if (key === "R1" || key === "R2") d.racewins++;
            if (key === "QR") d.qrwins++;
          }
          // Les podiums sont comptés une seule fois par GP (après la boucle RACE_ORDER)
        });
      });

      // ── Podiums GP : top-3 du classement combiné R1+R2 ────
      // On n'incrémente qu'une fois par GP, pas par manche.
      gpPodiumSet.forEach((nr) => {
        if (map[nr]) map[nr].podiums++;
      });

      if (perfectNr && map[perfectNr]) map[perfectNr].perfect++;
    });

    const rows = Object.values(map).map((d) => {
      const gps = d.gps_set.size;
      return {
        ...d,
        gps,
        avgPos: d.positions.length
          ? (
              d.positions.reduce((a, b) => a + b, 0) / d.positions.length
            ).toFixed(1)
          : "—",
        avgPts: gps > 0 ? (d.totalPts / gps).toFixed(1) : "—",
      };
    });

    return { rows, hasQR };
  }

  return { render, resetSort };
})();
