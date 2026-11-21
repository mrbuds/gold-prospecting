# Solveur web « Prospection d'or » (pré-saison 5)

**En ligne : https://mrbuds.github.io/gold-prospecting/**

Une page web 100 % JavaScript, en **un seul fichier** (`docs/index.html`, environ 75 Ko),
à partager avec l'alliance et le serveur. Elle marche sur téléphone comme sur PC, hébergée
(par exemple GitHub Pages) ou ouverte directement depuis le fichier, même hors ligne.
Aucune image ne quitte l'appareil ; le solveur conseille, il ne joue pas.

## Utilisation

1. Faire une capture de l'écran du mini-jeu, animations terminées. Les captures complètes
   sur PC sont acceptées : le panneau du mini-jeu est repéré dans l'image, sans recadrage manuel.
   Les captures portrait utilisent la détection rapide ; sinon, une recherche des zones
   brunes du plateau sur une image réduite localise le jeu avant la lecture à pleine résolution.
2. La coller dans la page (Ctrl+V), la glisser dessus, ou « Choisir une capture » (sur
   téléphone, ouvre la galerie).
3. La page lit le plateau, les 3 pièces, les objectifs et les compteurs, reconnaît le niveau,
   puis calcule : poses numérotées 1, 2, 3 sur le plateau, chaque pièce en main marquée de
   son numéro (« → 1 »), et le détail en texte (colonne, rangée depuis le bas).
   Un petit losange coloré dans le coin d'une case suggérée indique la gemme de la pièce à poser.
4. Si une case est mal lue : « Corriger », toucher la case (vide → bloc → bleu → orange →
   vert → rose), puis « Calculer ». Les compteurs se règlent avec − / +.

Langues : français, anglais, vietnamien (sélecteur en haut à droite).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `recognize.js` | lecture d'une capture (pixels d'un `<canvas>`) : plateau, pièces, objectifs, compteurs, niveau |
| `solver.js` | solveur (recherche exacte par lot, valeur estimée, fin de partie), bitboards sur deux entiers 32 bits |
| `data.js` | niveaux, modèles de pièces et poids réglés (fichier généré) |
| `app.html` | la page (interface, worker de calcul construit depuis la page elle-même) |
| `build.js` | `node build.js` → `docs/index.html` (tout en un, publié par GitHub Pages) |
| `test/` | captures annotées, banc de reconnaissance, cas de référence du solveur, simulation |

## Mesures (2026-11-21)

Reconnaissance, 12 captures réelles annotées, dont une capture PC complète avec pointeur
de souris (`test/truth.json`, `node test/run.js`) :
**768/768 cases, 36/36 pièces, niveau et compteurs 12/12**. Mêmes
résultats sur les captures réduites (×0,7, ×0,8), agrandies (×1,6, ×2,2) et bruitées
(`node test/robust.js`).

Configurations de bureau simulées à partir de la capture PC (`node test/desktop.js`) :
demi-écran, petite fenêtre décalée, double écran, double écran 4K, écrans superposés et
bureau portrait. Les six cas sont lus correctement, en environ 100 à 205 ms lors du test
local (reconnaissance seule, hors décodage de l'image et calcul du coup).

Solveur contre une implémentation de référence (`node test/compare.js`, cas dans
`test/cases.json`) : **1 247 poses sur 1 247 identiques** (plateau, lignes, gains) et
**60 plans sur 60 de même valeur** (partie déterministe ; le risque et l'anticipation
utilisent leurs propres tirages).

Parties simulées avec le solveur complet (`node test/sim.js 60`, règle de remplacement des
gemmes) : 300/300 gagnées, 15,1 coups en moyenne (référence : 14,9 sur d'autres tirages),
≈ 0,3 s par lot dans Node.

## Limites connues

- Reconnaissance validée sur des captures de vidéos au format portrait et une capture PC
  complète : à confirmer sur davantage de captures directes de téléphones et PC variés.
  Le plateau, les objectifs et les trois emplacements de pièces doivent être visibles et
  suffisamment lisibles ; une fenêtre très petite ou masquée peut empêcher la lecture.
- Une capture prise pendant une animation (pouces levés sur la colonne qui vient d'être
  remplie) est mal lue à cet endroit : corriger la case ou reprendre la capture.
- Chiffres 6, 8 et 9 des compteurs : absents des captures d'apprentissage, reconnus par leurs
  trous (deux trous = 8, trou en bas = 6, en haut = 9) ; à vérifier sur de vraies captures.
  Les modèles se réapprennent avec `node test/learn_digits.js` après ajout de captures
  annotées.
- Quand seul un objectif reste ouvert, deux niveaux peuvent être indiscernables
  (10201/10203, 10202/10204) : sans effet sur le conseil (mêmes pièces, même besoin).
- Une pose numérotée peut se dessiner sur des cases encore occupées : elles sont libérées par
  la pose précédente (le texte le signale).

## Mettre à jour

Après un changement de `app.html`, `recognize.js`, `solver.js` ou `data.js` : relancer les tests
(`node test/run.js`, `node test/compare.js`), puis `node build.js` et pousser `docs/index.html`
(GitHub Pages le republie en une minute environ).
