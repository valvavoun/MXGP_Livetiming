/* ═══════════════════════════════════════════════════════════
   MXGP Live Timing — capture.js
   Script d'auto-capture headless (sans navigateur, sans PC allumé).

   PRINCIPE :
   Au lieu de ré-écrire à la main la logique de connexion WebSocket,
   de parsing du flux SignalR, de détection de session et d'écriture
   Firebase — logique déjà écrite, testée et debuggée dans main.js et
   gp.js — ce script charge CES MÊMES FICHIERS, INCHANGÉS, dans un DOM
   virtuel (jsdom) qui reproduit fidèlement un navigateur.

   Résultat : comportement identique à 100 % à ce qui tourne dans un
   vrai navigateur, sans risque d'oubli ou de divergence future. Si tu
   modifies main.js/gp.js plus tard, ce script suit automatiquement
   sans rien retoucher ici.

   SÉCURITÉ FIREBASE :
   Les règles de la Realtime Database sont : .read:true / .write:false
   Pour que CE script (et lui seul) puisse écrire, chaque appel fetch()
   vers Firebase est intercepté et complété avec ?auth=<SECRET> — un
   "Database Secret" (legacy) qui bypass les règles. Ce secret n'est
   JAMAIS présent dans le code : il est injecté au runtime via la
   variable d'environnement FIREBASE_DB_SECRET (secret GitHub Actions).

   Aucun visiteur du site (lecture seule, fetch/EventSource classiques
   sans ce secret) ne peut donc écrire quoi que ce soit.
═══════════════════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const WebSocket = require("ws");
const EventSource = require("eventsource");

/* ── 0. Config / vérifications ─────────────────────────────── */

const DB_SECRET = process.env.FIREBASE_DB_SECRET;
if (!DB_SECRET) {
  console.error(
    "❌ Variable d'environnement FIREBASE_DB_SECRET manquante. " +
      "Ajoute-la comme secret GitHub Actions et passe-la au job (env:).",
  );
  process.exit(1);
}

/* Racine du site = dossier parent de /capture (repo checkouté par Actions) */
const SITE_ROOT = path.join(__dirname, "..");
const INDEX_HTML_PATH = path.join(SITE_ROOT, "index.html");
const JS_DIR = path.join(SITE_ROOT, "js");

if (!fs.existsSync(INDEX_HTML_PATH)) {
  console.error(`❌ index.html introuvable à ${INDEX_HTML_PATH}`);
  process.exit(1);
}

/* Durée max avant arrêt volontaire du script (marge de sécurité avant
   la limite dure de 6h imposée par GitHub Actions sur les jobs). */
const MAX_RUNTIME_MS = 5 * 60 * 60 * 1000 + 50 * 60 * 1000; // 5h50

/* ── 1. Construction du DOM virtuel à partir du VRAI index.html ── */

const html = fs.readFileSync(INDEX_HTML_PATH, "utf8");

const dom = new JSDOM(html, {
  url: "https://livetiming.local/", // juste un référentiel, jamais fetché
  runScripts: "dangerously", // requis pour exécuter nos <script> injectés ci-dessous
  pretendToBeVisual: true, // active requestAnimationFrame, getComputedStyle, etc.
});

const { window } = dom;

/* ── 2. Polyfills environnement navigateur manquants sous Node ── */

// WebSocket (jsdom n'en fournit pas). On enrobe la classe `ws` pour
// qu'elle envoie des en-têtes réalistes de navigateur (Origin,
// User-Agent) lors du handshake — certains backends (dont potentiellement
// liveresults.mxgp.com) se comportent différemment sans ces en-têtes.
class BrowserLikeWebSocket extends WebSocket {
  constructor(url, protocols) {
    super(url, protocols, {
      origin: "https://valvavoun.github.io",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });
  }
}
window.WebSocket = BrowserLikeWebSocket;

// EventSource RÉEL (pas un stub) : GP.init() lit tout l'arbre Firebase existant
// via SSE au démarrage — indispensable pour que les protections "déjà
// sauvegardé" (autoCapture / _writeLive) fonctionnent normalement et
// qu'on n'écrase jamais un résultat déjà enregistré.
window.EventSource = EventSource;

// localStorage minimal — settings.js s'en sert pour la visibilité des
// colonnes, complètement hors-sujet côté capture serveur, donc no-op.
window.localStorage = {
  _data: {},
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(this._data, k)
      ? this._data[k]
      : null;
  },
  setItem(k, v) {
    this._data[k] = String(v);
  },
  removeItem(k) {
    delete this._data[k];
  },
};

// fetch : Node ≥18 fournit fetch nativement. On enrobe l'appel pour
// injecter automatiquement ?auth=<SECRET> UNIQUEMENT sur les écritures
// (PUT/POST/PATCH/DELETE) vers la Realtime Database Firebase — sans
// jamais modifier une seule ligne de gp.js/main.js — ET pour LOGUER
// explicitement chaque tentative (succès ou échec), afin qu'aucune
// écriture ne puisse échouer en silence.
const realFetch = global.fetch;

function _shortUrl(u) {
  // Masque le secret dans les logs, même si GitHub redacte déjà les
  // secrets automatiquement — défense en profondeur.
  return u
    .replace(/([?&]auth=)[^&]+/, "$1***")
    .replace(/^https:\/\/[^/]+/, "");
}

window.fetch = async (input, opts = {}) => {
  let url = typeof input === "string" ? input : input?.url || "";
  const method = (opts.method || "GET").toUpperCase();
  const isFirebaseCall = url.includes("firebasedatabase.app");
  const isFirebaseWrite =
    isFirebaseCall && ["PUT", "POST", "PATCH", "DELETE"].includes(method);
  const isMxgpCall = url.includes("liveresults.mxgp.com");

  if (isFirebaseWrite) {
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}auth=${DB_SECRET}`;
    if (typeof input === "string") input = url;
  }

  /* Les endpoints MXGP (negotiate + start) sont conçus pour être appelés
     depuis un vrai navigateur. Node/fetch n'envoie par défaut ni
     User-Agent "navigateur", ni Origin, ni Referer — certains backends
     s'en servent pour valider/autoriser la requête (typiquement le
     `/start` qui dit au serveur SignalR de commencer à pousser les
     données). On les ajoute ici pour se rapprocher d'un vrai navigateur,
     sans écraser un header déjà fourni explicitement par le code. */
  if (isMxgpCall) {
    opts = { ...opts };
    opts.headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Origin: "https://valvavoun.github.io",
      Referer: "https://valvavoun.github.io/",
      Accept: "*/*",
      ...(opts.headers || {}),
    };
  }

  const t0 = Date.now();
  let res;
  try {
    res = await realFetch(input, opts);
  } catch (networkErr) {
    if (isFirebaseCall || isMxgpCall) {
      console.error(
        `[NET] ❌ ${method} ${_shortUrl(url)} — ERREUR RÉSEAU : ${networkErr.message}`,
      );
    }
    throw networkErr;
  }

  if (isFirebaseWrite) {
    const ms = Date.now() - t0;
    /* live.json s'écrit très souvent (à chaque changement de classement,
       toutes les quelques secondes en course) — logguer chaque succès
       spammerait les logs pour rien. On garde en revanche TOUJOURS ses
       échecs (utiles à déboguer), et TOUJOURS tout le reste (résultats
       finaux, DELETE...), succès comme échecs. */
    const isLiveWrite = url.includes("/live.json");
    if (res.ok) {
      if (!isLiveWrite) {
        console.log(`[FB] ✅ ${method} ${_shortUrl(url)} → ${res.status} (${ms}ms)`);
      }
    } else {
      let body = "";
      try {
        body = await res.clone().text();
      } catch {}
      console.error(
        `[FB] ❌ ${method} ${_shortUrl(url)} → ${res.status} ${res.statusText}` +
          (body ? ` — ${body.slice(0, 300)}` : ""),
      );
    }
  } else if (isMxgpCall && !res.ok) {
    const ms = Date.now() - t0;
    console.error(
      `[MXGP-HTTP] ❌ ${method} ${_shortUrl(url)} → ${res.status} (${ms}ms)`,
    );
  }

  return res;
};

/* Rendre le contexte global de Node cohérent avec window, au cas où
   du code du site référence `document`/`navigator` sans passer par
   `window.` explicitement. */
global.window = window;
global.document = window.document;
global.navigator = window.navigator;
global.WebSocket = BrowserLikeWebSocket;
global.EventSource = EventSource;

/* Étouffer les warnings jsdom "not implemented" (scrollTo, etc.) —
   purement cosmétique, sans incidence fonctionnelle ici. */
dom.virtualConsole.on("jsdomError", () => {});

/* Signale à gp.js qu'on tourne en headless (script de capture, pas un
   navigateur réel) — permet à _writeLive() d'écrire en continu ici,
   alors qu'un vrai visiteur n'écrit que quand il a le panel GP
   Standings ouvert (comportement d'origine, pas de spam inutile). */
window.__MXGP_HEADLESS__ = true;
global.__MXGP_HEADLESS__ = true;

/* ── 3. Chargement des VRAIS fichiers du site, dans le même ordre
   que index.html (settings.js → gp.js → main.js).
   stats.js et duel.js ne sont pas nécessaires côté capture : ils ne
   font que de l'affichage déclenché par des clics utilisateurs, qui
   n'existent pas ici. main.js les référence via `typeof X !== "undefined"`
   et gère déjà leur absence proprement. ── */

["settings.js", "gp.js", "main.js"].forEach((file) => {
  const filePath = path.join(JS_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Fichier manquant : ${filePath}`);
    process.exit(1);
  }
  const code = fs.readFileSync(filePath, "utf8");
  try {
    /* IMPORTANT : on injecte une VRAIE balise <script>, pas un eval().
       Avec eval(), un `const GP = (() => {...})()` déclaré au top-level
       reste piégé dans cet appel d'eval() précis et ne devient JAMAIS
       une vraie variable globale visible par le <script> suivant — ce
       qui rendait `typeof GP` égal à "undefined" dans main.js, et donc
       GP.autoCapture() n'était JAMAIS appelée, silencieusement. De
       vraies balises <script> partagent l'environnement global du
       document, exactement comme dans un navigateur. */
    const scriptEl = window.document.createElement("script");
    scriptEl.textContent = code;
    window.document.body.appendChild(scriptEl);
  } catch (e) {
    console.error(`❌ Erreur en chargeant ${file} :`, e);
    process.exit(1);
  }
});

console.log("✅ settings.js / gp.js / main.js chargés — capture en cours…");
console.log(
  `▶ Arrêt automatique programmé dans ${Math.round(MAX_RUNTIME_MS / 60000)} min`,
);

/* ── 4. Filet de sécurité — ne jamais laisser une erreur non gérée
   tuer le process en plein milieu de la fenêtre de course. main.js a
   déjà sa propre logique de reconnexion (scheduleRetry) ; ici on
   protège juste le process Node lui-même. ── */
process.on("uncaughtException", (e) => {
  console.error("⚠ uncaughtException (le script continue) :", e);
});
process.on("unhandledRejection", (e) => {
  console.error("⚠ unhandledRejection (le script continue) :", e);
});

/* ── 5. Arrêt propre en fin de fenêtre ── */
setTimeout(() => {
  console.log("⏹ Fin de fenêtre programmée — arrêt propre du script.");
  process.exit(0);
}, MAX_RUNTIME_MS);

/* Garder le process Node vivant : sans ça, Node se termine dès que la
   boucle d'événements se vide alors que WebSocket/timers doivent
   continuer à tourner en tâche de fond pendant des heures. */
setInterval(() => {}, 1 << 30);
