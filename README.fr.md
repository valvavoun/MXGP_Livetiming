# 🏁 MXGP Live Timing

Interface de live timing non-officielle connectée en temps réel à **liveresults.mxgp.com** — la plateforme officielle des résultats MXGP.

> Projet fan-made — aucune affiliation avec la FIM, Infront Moto Racing ou MXGP.

> 🤖 Ce projet a été réalisé à 100% avec [Claude](https://claude.ai) d'Anthropic — du design de l'interface à chaque ligne de code.

---

## 📺 Live Timing

À l'ouverture, l'application se connecte automatiquement. Dès qu'une session est en cours (Free Practice, Qualification, Course…), le tableau affiche tous les pilotes en piste et se met à jour en temps réel.

Chaque ligne indique la **position, le numéro, le nom, la nationalité, la moto, les écarts, les temps au tour, les temps sectoriels et le statut** du pilote. La couleur du dossard correspond à la marque de moto (orange pour KTM, rouge pour Honda, vert pour Kawasaki, etc.). Un bandeau défilant en bas de page résume le leader, le meilleur tour et le top 8.

---

## ⚙️ Réglage des colonnes — bouton engrenage (en haut à droite)

Certaines colonnes ne vous intéressent pas ? Cliquez sur le **bouton ⚙ engrenage** pour afficher ou masquer n'importe quelle colonne du tableau. Vos choix sont sauvegardés automatiquement dans le navigateur — ils seront toujours là à votre prochaine visite. Un **point jaune** sur le bouton signale que des colonnes sont actuellement masquées. Cliquez sur **↺ Reset** pour tout réafficher.

---

## ⏱ Délai — bouton chrono (en bas à droite)

Vous regardez la course à la TV ou sur un stream avec quelques secondes de décalage ? Le **bouton ⏱** permet de ralentir le live timing pour qu'il reste synchronisé avec ce que vous regardez. Choisissez un préréglage (**0 / 10 / 15 / 30 / 60 secondes**) ou entrez n'importe quelle valeur jusqu'à 300 secondes.

---

## ⚔️ Mode Duel — cliquer sur une ligne

Envie de comparer deux pilotes ? **Cliquez sur leurs lignes** dans le tableau. Un panneau s'ouvre automatiquement dès que vous en avez sélectionné au moins 2, avec :

- **L'écart en course** — temps entre les deux pilotes en direct (passe en rouge sous 1 seconde)
- **Meilleur tour et dernier tour** — côte à côte
- **Temps sectoriels S1–S4** — qui est plus rapide sur chaque partie du circuit
- **Score d'avantage sectoriel** — le vainqueur global sur l'ensemble des secteurs

Le meilleur temps sur chaque métrique est mis en évidence avec la couleur de la moto du pilote. Vous pouvez comparer jusqu'à **8 pilotes simultanément**. Recliquez un pilote pour le désélectionner. Appuyez sur **Échap** pour tout fermer.

---

## 🏆 Classement GP du week-end — bouton GP (en haut à droite)

Le **bouton GP** affiche le classement général du week-end, calculé automatiquement selon le **barème officiel FIM** :

| Session | Pilotes scorés | Points |
|---|---|---|
| Qualifying Race | Top 10 | 10 → 1 |
| Race 1 | Top 20 | 25 → 1 |
| Race 2 | Top 20 | 25 → 1 |

Pendant une course en cours, un aperçu 🔴 **Live** affiche les positions et les points provisoires en temps réel — partagé entre tous les utilisateurs connectés. Les résultats sont sauvegardés automatiquement à la fin de chaque manche et se remettent à zéro chaque vendredi pour le nouveau week-end de course.

