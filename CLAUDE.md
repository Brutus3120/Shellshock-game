# CLAUDE.md

Guide pour Claude Code (claude.ai/code) travaillant dans ce dépôt.

## Ce que c'est

**ÉCLAT** — un FPS 3D arcade jouable hors ligne contre des bots, dans un navigateur, sans
build, sans npm, sans compte, sans base de données et sans le moindre octet de réseau une fois
le dépôt cloné. Quatre cartes, trois armes, trois difficultés de bots, un match à durée
configurable.

La contrainte qui explique presque tout le code : **ça doit tourner sur un PC faible**. Le
budget n'est pas « beau », c'est « stable à 60 fps sur un GPU intégré ». Chaque décision
ci-dessous est un arbitrage rendu sous cette contrainte, pas une préférence esthétique.

## Lancer

```bash
./play.sh          # Linux/macOS
play.bat           # Windows
python3 serve.py   # équivalent direct
```

Puis <http://127.0.0.1:8000>. Aucune installation : Python 3 (déjà présent presque partout) et
un navigateur récent suffisent.

**Pourquoi un serveur alors que le jeu est local ?** Les modules ES ne se chargent pas depuis
`file://` (CORS). `serve.py` est un `http.server` de trente lignes lié à **`127.0.0.1`
uniquement** — jamais `0.0.0.0` : le jeu n'a pas à être joignable depuis le réseau. Il replie
sur 20 ports si 8000 est pris et force `Cache-Control: no-store` plus le bon type MIME
(`.js → text/javascript`, sans quoi le navigateur refuse le module).

## Technologie

Three.js **r169**, vendoré dans `vendor/three.module.js` (687 Ko, MIT), importé directement par
le navigateur. Pas de npm, pas de bundler, pas d'étape de build : on édite un fichier, on
recharge l'onglet. C'est aussi ce qui rend le projet installable par quelqu'un qui n'a pas de
chaîne d'outils JavaScript.

## Carte des modules

```
index.html        écrans (menu, cartes, options, pause, fin, chargement) + HUD
css/style.css     tout le style ; le HUD est du DOM, pas du canvas
serve.py          serveur local 127.0.0.1
js/
  main.js         point d'entrée : câble menu ↔ partie, boucle rAF
  menu.js         navigation entre écrans, sélection carte/bots/difficulté
  settings.js     persistance des options dans localStorage
  config.js       TOUT l'équilibrage : joueur, armes, difficultés, qualité
  maps.js         les 4 cartes, décrites en listes de boîtes
  world.js        fusion géométrique, lumières, graphe de navigation
  collision.js    AABB, grille, raycast DDA, déplacement d'acteur
  player.js       état et physique du joueur
  input.js        clavier/souris, pointer lock (ZQSD + WASD + flèches)
  weapons.js      chargeur, cadence, recharge, hitscan
  bots.js         perception, décision, visée, tir, déplacement
  effects.js      traceurs et étincelles, en pools
  hud.js          barre de vie, munitions, score, killfeed, minimap
  audio.js        SFX synthétisés à la volée en WebAudio
  game.js         le match : monde, acteurs, tir, caméra, rendu, classement
```

## Invariants porteurs

Ce sont les endroits où une modification « évidente » casse silencieusement quelque chose.

- **Un seul draw call pour le décor.** `world.js` fusionne toutes les boîtes d'une carte en une
  `BufferGeometry` unique, couleur par sommet, `MeshLambertMaterial({vertexColors:true})`.
  Ajouter un mesh séparé par bâtiment est la façon la plus rapide de perdre le budget GPU.
- **L'occlusion ambiante est cuite dans les sommets**, à la construction de la carte. Chaque face
  est découpée en quads d'au plus `aoTile` mètres (`QUALITY` dans `config.js`) et chaque nœud de
  cette grille est assombri selon le solide qui l'entoure, sondé par `collision.overlaps`. Coût au
  rendu : zéro, la couleur de sommet est déjà lue par le shader. Trois conséquences à connaître :
  la collision doit être construite **avant** la géométrie (l'AO l'interroge) ; une carte compte
  désormais des dizaines de milliers de triangles au lieu de quelques centaines, ce qui reste un
  seul draw call ; et baisser `aoTile` resserre les ombres de contact en multipliant les triangles
  par le carré du rapport. Une face ne peut pas être plus sombre entre deux de ses sommets : c'est
  toute la raison de la subdivision.
- **Collision purement AABB.** Pas de mesh de collision, pas de moteur physique. Le relief est
  fait d'escaliers de boîtes, franchis par un *step-up* automatique de 0,62 m résolu par
  recherche binaire dans `moveActor`. Une rampe inclinée ne serait pas gérée.
- **`sampleY` par carte.** `groundHeight` sonde le sol par un rayon vers le bas ; dans une carte
  **couverte** (`bunker`, plafond à 4,6 m) un rayon parti de y=40 touche le plafond et fait
  apparaître joueur, bots **et tout le graphe de navigation sur le toit**. D'où `sampleY` dans
  chaque carte : 40 à ciel ouvert, `H - 0.5` sous un plafond. Toute nouvelle carte fermée doit
  le définir.
- **Le graphe de nav est généré, pas dessiné.** `buildNav` échantillonne une grille de 3 m et
  garde les points où une capsule tient debout. Pas d'A\* : les bots se dirigent tout droit et
  évitent avec trois rayons « moustaches ». Conséquence : une carte doit rester *lisible en
  ligne droite*, un labyrinthe piégerait les bots.
- **Pools de taille fixe** pour traceurs et étincelles (`effects.js`) : zéro allocation pendant
  le combat, donc aucun à-coup de GC. Ne pas remplacer par des créations à la volée.
- **Le HUD est du DOM.** Il reste net quand `renderScale` descend à 0,65, et le GPU ne le touche
  jamais. Le passer en canvas coûterait des deux côtés.
- **Deux scènes, deux caméras.** L'arme en vue subjective vit dans sa propre scène avec une
  caméra fov 55 **indépendante du FOV joueur**, rendue après `clearDepth()`. C'est ce qui
  l'empêche de traverser les murs et de se déformer au zoom.
- **Éclairage physique r169.** Depuis r155 l'intensité 1 est très sombre : `HEMI_GAIN = 3.4` et
  `SUN_GAIN = 3.6` compensent. Deux lumières au total, jamais plus.
- **Tone mapping ACES, exposition par carte.** `_setupRenderer` pose `ACESFilmicToneMapping` et
  lit `exposure` dans la carte. Le piège est que **le brouillard et le fond de scène n'y passent
  pas** : three.js applique `fog_fragment` après `tonemapping_fragment`, et un `scene.background`
  de type `Color` devient une couleur d'effacement qui ne traverse jamais le shader. Seule la
  géométrie éclairée est tone-mappée. Monter l'exposition déplace donc le décor en laissant
  l'horizon sur place, et l'accord entre les deux se défait. D'où la règle de réglage : chaque
  `exposure` est choisie pour **conserver la luminosité moyenne** de la carte avant la courbe.
  Ce qu'on gagne n'est pas de la lumière, c'est de l'écart — à luminosité égale, l'écart-type de
  luminance monte de 20 % (Arène) à 40 % (Bunker). Pour accorder l'horizon, c'est `sky` et `fog`
  qu'il faut bouger, jamais `exposure`.
- **Additive blending obligatoire** sur traceurs et étincelles, sinon ils sortent en traits
  sombres sur fond clair.
- **Pointer lock exige un geste utilisateur** et impose un délai après Échap — d'où l'écran
  « cliquer pour jouer ». `#overlay` est en `pointer-events:none`, seuls les `.screen` captent
  les clics ; l'inverse avale les clics destinés au canvas.

## Où changer quoi

| Envie | Fichier |
|---|---|
| Équilibrer une arme, la vie, la vitesse | `js/config.js` |
| Rendre les bots plus durs | `DIFFICULTIES` dans `js/config.js` |
| Gagner des FPS | `QUALITY` dans `js/config.js` (`renderScale`, `fogFar`, `aoTile`) |
| Régler la netteté des ombres de contact | `aoTile` dans `QUALITY`, constantes `AO_*` de `js/world.js` |
| Régler l'ambiance lumineuse d'une carte | `exposure`, `sun` et `hemi` de la carte dans `js/maps.js` |
| Modifier ou ajouter une carte | `js/maps.js` (helpers `B`, `perimeter`, `stairs`, `building`) |
| Comportement des bots | `js/bots.js` (`sense` / `think` / `aim` / `move`) |
| Placement de l'arme à l'écran | `_setupViewModel` dans `js/game.js` |

Dans `maps.js`, `B(x,y,z,w,h,d,color)` prend **x/z au centre mais y à la base**. C'est la source
d'erreur numéro un quand on ajoute une boîte.

## Règles de travail

- **Rien d'externe.** Pas de CDN, pas de police web, pas de fichier audio, pas de texture, pas
  d'analytics. Le jeu doit fonctionner câble débranché, et le rester.
- **Aucun asset copié.** Toutes les formes, palettes, cartes et armes sont originales ; le son
  est synthétisé. Ne pas importer de contenu d'un jeu existant.
- **Ajouter une dépendance est un choix à justifier**, pas un réflexe. Aujourd'hui il y en a une
  seule, vendorée.
- **Vérifier dans un vrai navigateur**, pas par lecture. Le harnais dispose de Chromium
  (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, lancer avec `--use-gl=angle
  --use-angle=swiftshader --enable-unsafe-swiftshader`). Le test qui a de la valeur est une
  simulation de 60 s sur chaque carte : on regarde le nombre d'éliminations, les bots bloqués au
  spawn, les acteurs passés sous le sol, et la console.
- **Le projet doit rester petit et lisible.** C'est une exigence du cahier des charges, pas un
  effet de bord.
