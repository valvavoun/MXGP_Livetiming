# 🏁 MXGP Live Timing

Unofficial live timing interface connected in real time to **liveresults.mxgp.com** — the official MXGP results platform.

> Fan-made project — no affiliation with FIM, Infront Moto Racing or MXGP.

> 🤖 This project was built 100% with [Claude](https://claude.ai) by Anthropic — from the interface design to every line of code.

---

## 📺 Live Timing

When you open the app, it connects automatically. As soon as a session is live (Free Practice, Qualifying, Race…), the table fills with all riders on track and updates in real time.

Each row shows a rider's **position, number, name, nationality, bike brand, gaps, lap times, sector times and status**. The number badge color matches the bike brand (orange for KTM, red for Honda, green for Kawasaki, etc.). A scrolling ticker at the bottom of the screen summarises the leader, fastest lap and top 8.

---

## ⚙️ Column Settings — gear button (top right)

Not interested in some columns? Click the **⚙ gear button** to show or hide any column from the table. Your choices are saved automatically in the browser — they'll still be there next time you visit. A small **yellow dot** on the button means some columns are currently hidden. Hit **↺ Reset** to bring them all back.

---

## ⏱ Delay — timer button (bottom right)

Watching the race on TV or a stream that's a few seconds behind? The **⏱ delay button** lets you slow down the live timing to match your broadcast. Choose a preset (**0 / 10 / 15 / 30 / 60 seconds**) or type any value up to 300 seconds. The timing data will be held back accordingly so your screen stays in sync with what you're watching.

---

## ⚔️ Duel Mode — click any row

Want to compare two riders head-to-head? Just **click their rows** in the table. A panel opens automatically once you've selected at least 2 riders, showing:

- **Gap in race** — live time between the two riders (turns red when under 1 second)
- **Best lap & last lap** — side by side
- **Sector times S1–S4** — who's faster on each part of the track
- **Sector advantage score** — overall winner across all sectors

The faster time on each metric is highlighted in the rider's bike color. You can compare up to **8 riders at once**. Click a rider again to deselect them. Press **Escape** to close and clear everything.

---

## 🏆 GP Weekend Standings — GP button (top right)

The **GP button** shows the overall weekend standings, automatically calculated using the **official FIM points system**:

| Session | Riders scored | Points |
|---|---|---|
| Qualifying Race | Top 10 | 10 → 1 |
| Race 1 | Top 20 | 25 → 1 |
| Race 2 | Top 20 | 25 → 1 |

During a live race, a 🔴 **Live** preview shows provisional standings and points in real time — shared between all connected users. Results are saved automatically when a session finishes and reset every Friday for the new race weekend.

