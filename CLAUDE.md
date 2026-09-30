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
  world.js        fusion géométrique (décor et personnages), lumières, graphe de navigation
  collision.js    AABB, grille, raycast DDA, déplacement d'acteur
  player.js       état et physique du joueur
  input.js        clavier/souris, pointer lock (ZQSD + WASD + flèches)
  weapons.js      chargeur, cadence, recharge, hitscan
  bots.js         perception, décision, visée, tir, déplacement
  effects.js      traceurs, étincelles, flashs et ombres de contact, en pools
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
- **Un bot est quatre maillages, pas neuf.** `buildBotMesh` fusionne ses neuf boîtes en quatre
  géométries à couleur par sommet (`mergeBoxGeometry` dans `world.js`) : jambe gauche, jambe
  droite, buste, bras + arme. Un `Mesh` est un draw call, et onze bots à neuf maillages en
  coûtaient 99 contre 1 pour la carte entière. Le découpage suit le **mouvement**, pas
  l'anatomie : on ne sépare que ce qui doit bouger indépendamment — les jambes sont pivotées à la
  hanche pour le cycle de marche à venir, le bras au niveau de l'épaule, dont `muzzlePosition`
  (`game.js`) code en dur les 0,30 m et 1,18 m. Ajouter une pièce à un bot, c'est ajouter une
  ligne à `bodyParts` ou `armParts`, jamais un `Mesh` de plus. La couleur passe par les sommets
  parce qu'un groupe mélange des teintes ; le matériau, lui, reste propre à chaque bot.
- **Deux teintes sont réservées au signal**, et rien d'autre n'a le droit de s'en approcher :
  l'orange `#ff7a3c` (`SIGNAL_ORANGE` dans `config.js`) désigne l'hostile — chevron d'épaule des
  bots aujourd'hui, explosions et dégâts reçus demain — et le teal `#4fd1c5` (`--accent` dans
  `style.css`) désigne le joueur et l'interface. `BOT_COLORS` s'est fait retirer quatre teintes
  pour cette règle : un cyan et un turquoise à **1°** de teinte du teal, un orange brûlé à 8° du
  signal, et un saumon sur lequel le chevron ne se détachait pas. L'écart minimal est aujourd'hui
  de 19°, et une nouvelle couleur de bot doit s'y tenir : les bandes 10-40° (orange) et 160-200°
  (cyan) sont interdites. Le chevron lui-même **déborde** du torse de 4 cm — une boîte noyée dans
  une autre ne se voit pas — et ne coûte aucun draw call, le buste étant un maillage fusionné.
- **Le fond de scène n'est pas tone-mappé, le brouillard si.** Depuis l'étape 3 le rendu passe par
  `ACESFilmicToneMapping`, avec une exposition **par carte** (`exposure` dans `maps.js`, 1,10 à
  1,22) : la courbe creuse les noirs, le rattrapage les récupère. Mais `scene.background` est une
  couleur d'effacement du framebuffer et échappe à cette courbe, alors que le brouillard, calculé
  dans le shader, la subit — sur l'Arène, le mur lointain passe de (17,27,44) à (3,11,27) pendant
  que le fond reste à (42,49,66). D'où le ciel en géométrie (`buildSky` dans `world.js`) : une
  sphère retournée à couleur par sommet, dont le bas **est** la couleur de brouillard de la carte,
  donc le raccord à l'horizon redevient invisible. Le dégradé ne vit que dans l'hémisphère
  supérieur, sinon l'horizon démarre déjà à 61 % de la teinte du zénith. Une carte couverte
  (`bunker`) ne déclare pas de `skyTop` et n'a donc pas de ciel — ni le draw call, ni le
  remplissage. Éclaircir un ciel, c'est éclaircir `fog` ET `skyBottom` ensemble, jamais l'un des
  deux seul.
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
- **Pools de taille fixe** pour traceurs, étincelles, flashs de bouche et ombres de contact
  (`effects.js`) : zéro allocation pendant le combat, donc aucun à-coup de GC. Ne pas remplacer
  par des créations à la volée.
- **Le HUD est du DOM.** Il reste net quand `renderScale` descend à 0,65, et le GPU ne le touche
  jamais. Le passer en canvas coûterait des deux côtés. Les arcs de direction des dégâts suivent
  la même logique : un cercle dont seule la bordure **haute** est peinte donne un secteur de 90°
  pointant vers le haut, qu'une rotation oriente — aucune image, aucun canvas. Ils sont **en
  pool** comme les effets 3D : quatre nœuds créés une fois, jamais en combat.
- **La direction des dégâts vit dans le repère de la CAMÉRA, pas du monde.** `game.js` calcule
  l'angle avec l'avant `(-sin, -cos)` et la droite `(cos, -sin)` du lacet de vue, ce qui donne 0
  droit devant et positif vers la droite — exactement le sens de `rotate()` en CSS, donc `hud.js`
  n'a rien à convertir. Toute conversion ajoutée quelque part entre les deux casse l'indicateur
  d'une façon qui ne se voit qu'en jeu. La vignette de vie basse, elle, a une **hystérésis**
  (allumée sous 30, éteinte au-dessus de 35) : sans elle, encaisser à la frontière la fait
  clignoter.
- **Deux scènes, deux caméras.** L'arme en vue subjective vit dans sa propre scène avec une
  caméra fov 55 **indépendante du FOV joueur**, rendue après `clearDepth()`. C'est ce qui
  l'empêche de traverser les murs et de se déformer au zoom.
- **Éclairage physique r169.** Depuis r155 l'intensité 1 est très sombre : `HEMI_GAIN = 3.4` et
  `SUN_GAIN = 3.6` compensent. Deux lumières au total, jamais plus.
- **Additive blending obligatoire** sur traceurs, étincelles et flashs de bouche, sinon ils
  sortent en traits sombres sur fond clair.
- **Le flash de bouche est une étoile à couleur de sommet** : un éventail de triangles dont le
  centre porte la couleur et dont **tout le pourtour est noir**. En additif le noir ne dessine
  rien, donc ce noir *est* le dégradé — l'« éclaircir » rendrait un polygone plat et opaque. Même
  silhouette des deux côtés (`FLASH_RADII` dans `weapons.js`), mais deux implantations : le joueur
  a la sienne accrochée à son arme, donc elle suit le recul sans code ; les bots passent par un
  pool de `effects.js`, orienté face à la caméra à l'allumage. `VM_FLASH_SCALE` réduit la première :
  les deux caméras ne regardent pas à la même distance.
- **L'ombre de contact est le seul effet MULTIPLICATIF du jeu**, et trois détails la font
  exister ou disparaître. Son disque est un éventail à deux anneaux : centre et anneau intérieur
  sombres — le noyau —, bord blanc, et en multiply le blanc est l'élément **neutre**, donc c'est
  le dégradé du noyau vers le bord qui adoucit. Les trois détails : l'**enroulement**, car avec
  `(cos a, 0, sin a)` la normale des triangles pointe vers le bas et le disque est éliminé en face
  arrière (d'où le sinus opposé dans `effects.js`) ; **`toneMapped: false`**, sans quoi la courbe
  ACES s'applique au blanc du pourtour, qui cesse d'être neutre et cerne l'ombre d'un disque plus
  sombre que le sol ; et la teinte du noyau (`SHADOW_DARK`), donnée en **linéaire** alors que le
  mélange a lieu après encodage sRGB — 0,18 linéaire vaut environ 0,46 à l'écran. La sonde de sol
  (`updateShadows` dans `game.js`) part des **pieds** de l'acteur et jamais de `sampleY` comme
  `groundAt`, qui trouverait le toit au-dessus de lui ; au contact elle est sautée. Un acteur au
  bord d'une caisse verra son disque déborder dans le vide : c'est assumé, le corriger coûterait
  quatre sondes par acteur et par image.
- **Pointer lock exige un geste utilisateur** et impose un délai après Échap — d'où l'écran
  « cliquer pour jouer ». `#overlay` est en `pointer-events:none`, seuls les `.screen` captent
  les clics ; l'inverse avale les clics destinés au canvas.

## Où changer quoi

| Envie | Fichier |
|---|---|
| Équilibrer une arme, la vie, la vitesse | `js/config.js` |
| Rendre les bots plus durs | `DIFFICULTIES` dans `js/config.js` |
| Gagner des FPS | `QUALITY` dans `js/config.js` (`renderScale`, `fogFar`, `aoTile`) |
| Régler l'ambiance d'une carte | `exposure`, `fog`, `skyBottom`/`skyTop` dans `js/maps.js` |
| Régler la netteté des ombres de contact | `aoTile` dans `QUALITY`, constantes `AO_*` de `js/world.js` |
| Modifier ou ajouter une carte | `js/maps.js` (helpers `B`, `perimeter`, `stairs`, `building`) |
| Comportement des bots | `js/bots.js` (`sense` / `think` / `aim` / `move`) |
| Silhouette d'un bot | `bodyParts` / `armParts` dans `js/bots.js`, armes dans `js/weapons.js` |
| Placement de l'arme à l'écran | `_setupViewModel` dans `js/game.js` |
| Force et taille des ombres de contact | `SHADOW_*` dans `js/effects.js`, `updateShadows` dans `js/game.js` |

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
