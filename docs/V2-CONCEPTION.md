# ÉCLAT V2 — conception

## Pourquoi cette V2

ÉCLAT V1 fonctionne et tient les 60 fps sur GPU intégré : 3 964 lignes, une seule dépendance
vendorée (Three.js r169), un draw call pour tout le décor. Le problème n'est pas la performance,
c'est que le jeu ressemble encore à ce qu'il est techniquement — un assemblage de boîtes bien
optimisé. Trois armes, quatre cartes, aucun flash de bouche, aucune fumée, aucune ombre au sol
en dessous du préréglage « haut ».

L'objectif de cette V2 : donner au jeu une identité visuelle et une variété d'armement dignes
d'un petit FPS fini, sans toucher aux invariants qui le rendent installable et rapide. Ce
document est la conception. Aucun code n'est écrit à ce stade.

Le budget disponible est réel et mesurable : la carte coûte 1 draw call, les bots en coûtent
aujourd'hui une centaine. C'est là que se trouve la marge.

---

# Audit de la V1

## Ce qui marche et qu'il ne faut pas refaire

La fusion géométrique de `world.js` (une `BufferGeometry` par carte, couleur par sommet), la
collision AABB avec grille et DDA, le graphe de navigation généré à 3 m, les pools fixes de
`effects.js`, le HUD en DOM, les deux scènes/deux caméras, le son synthétisé WebAudio. Tout cela
est correct et doit rester tel quel. La V2 s'ajoute à cette base, elle ne la remplace pas.

## Limites graphiques

**Le décor n'a pas de profondeur.** Le seul volume vient de `FACE_SHADE`
(`[0.86, 0.80, 0.92, 0.78, 1.0, 0.62]` dans `world.js:30`), qui assombrit chaque face selon son
orientation. Il n'y a aucune occlusion ambiante, aucune variation entre deux boîtes de même
couleur, aucun liseré sur les arêtes. Le sol de l'Arène est une boîte de 54 × 54 m : une surface
plate uniforme qui occupe la moitié de l'écran.

**Pas de ciel.** `scene.background` reçoit une couleur unie (`game.js:76`). L'horizon n'existe
pas, donc les cartes extérieures n'ont pas de hors-champ. Le brouillard linéaire démarre à
`fogFar * 0.45` et sert uniquement à cacher la coupure lointaine.

**Aucune gestion de tonalité.** Le `WebGLRenderer` est créé sans `toneMapping` ni
`toneMappingExposure` (`game.js:_setupRenderer`). Les couleurs sortent brutes, les zones claires
saturent à plat. Un `ACESFilmicToneMapping` avec une exposition par carte change complètement la
lecture des couleurs pour quelques instructions de fragment shader.

**Les acteurs ne touchent pas le sol.** Les ombres ne sont actives que sur le préréglage `haut`
(`QUALITY.haut.shadows: true`). Sur `bas` et `moyen`, c'est-à-dire la cible du projet, les bots
flottent visuellement.

**Les bots coûtent cent fois plus cher que la carte.** `buildBotMesh` crée 7 `Mesh` séparés
(torse, hanches, deux jambes, tête, visière, bras) plus le groupe arme à 2 boîtes, soit environ
9 draw calls par bot. Avec 12 bots, plus de 100 draw calls, contre 1 pour le décor entier.
Chaque bot alloue en plus ses propres géométries et matériaux, sans partage. C'est le poste où il
y a le plus à gagner, et c'est celui qui finance tout le reste du budget visuel.

**Aucun flash de bouche.** `muzzlePosition()` existe dans `game.js` mais ne sert qu'à placer le
départ de la traçante. Rien ne s'allume quand on tire — c'est ce qui manque le plus à la sensation
de tir.

**Le catalogue d'effets est minimal.** 48 traçantes (`LineSegments` additif) et 160 étincelles
(`Points` additif, taille 0,075). Ni fumée, ni poussière, ni douilles, ni impacts persistants, ni
explosion. `addTracer` et `addImpact` allouent par ailleurs un `new THREE.Color()` à chaque appel,
donc à chaque coup tiré : c'est petit, mais c'est une allocation en plein combat, contraire à
l'esprit du fichier.

**Les cartes n'ont pas de repères.** Les quatre angles de l'Arène sont identiques. Rien ne permet
de savoir où on est sans regarder la mini-carte. Aucun élément décoratif sous 1 m à part les
caisses, donc rien à hauteur de regard pour donner l'échelle.

## Limites de gameplay

**Trois armes, et le chiffre 3 est écrit en dur un peu partout.** `WEAPON_ORDER` sert à la fois
de catalogue et d'inventaire : `Loadout` instancie les trois armes pour tout le monde, `index.html`
déclare trois `.slot`, `input.js` expose `KEY.w1/w2/w3`, et `bots.js` tire son arme au hasard avec
`WEAPON_ORDER[(Math.random() * 3) | 0]` — à deux endroits. Ajouter des armes impose donc de
séparer le catalogue (toutes les armes du jeu) de l'inventaire (les 3 emplacements portés).

**Le tir est exclusivement hitscan.** `fireShot` lance un rayon par plomb et résout tout
immédiatement. Un lance-projectiles ou une arme à charge demande une liste de projectiles simulés,
elle aussi poolée.

**La distance d'engagement des bots est codée par identifiant d'arme** :
`def.id === 'broyeur' ? 6 : (def.id === 'lynx' ? 26 : 14)` dans `bots.move`, plus un
`if (def.id === 'broyeur' && dist > 16) return;` dans `bots.shoot`. Avec neuf armes, ces tests
doivent devenir un champ `idealRange` lu depuis `config.js`.

**Le calcul de chute de dégâts divise par `def.range - def.falloffStart`.** Aucune arme actuelle
ne déclenche la division par zéro, mais six nouvelles définitions la rendent possible. À garder en
tête au moment d'écrire les stats.

**Tous les bots d'une difficulté donnée sont identiques.** Seule leur couleur et leur arme tirée
au hasard changent. Il n'existe aucun archétype, alors que la machine à états
(patrouille/traque/combat/couvert) accepterait très bien des paramètres différents sans une ligne
d'IA supplémentaire.

**La lisibilité des ennemis n'est pas garantie.** `BOT_COLORS` contient `0x5ad1e8`, un cyan très
proche du `--accent` teal de l'interface et de la couleur du joueur (`0x6fd3ff`). Rien ne distingue
structurellement un ennemi d'un élément d'interface.

**La mini-carte ignore la hauteur.** Un bot sur un toit et un bot dans le dos du joueur sont deux
points rouges identiques, sur une carte qui mise justement sur la verticalité.

---

# Direction artistique proposée

## Le nom comme point de départ

« Éclat » veut dire deux choses : le flash, et le fragment de minéral. La direction artistique
s'appuie sur les deux. Des volumes taillés, des arêtes nettes, des faces planes qui prennent la
lumière différemment — et par-dessus, des sources lumineuses franches et brèves.

**Nom de la DA : taille minérale.** Le monde est fait de blocs de béton, de roche et de tôle
peinte, éclairés à contre-jour, avec un seul accent saturé par carte. Rien n'essaie de simuler une
matière réelle. Tout assume la facette.

## Les cinq règles

1. **Cinq teintes maximum par carte.** Deux neutres (sol sombre, murs moyens), un minéral
   saturé propre à la carte, et deux couleurs réservées au signal.

2. **Les couleurs de signal sont sacrées et communes à tout le jeu.** L'orange `#ff7a3c` désigne
   l'hostile et le danger — chevron d'épaule des bots, zone d'explosion, dégâts reçus. Le teal
   `#4fd1c5` désigne le joueur et l'interface. Aucune carte, aucun décor, aucun bot n'a le droit
   d'utiliser ces deux teintes. C'est ce qui garantit qu'une silhouette orange à 40 m est toujours
   une cible, jamais un mur.

3. **La valeur fait le travail, pas la saturation.** Sols sombres, verticales moyennes, dessus
   clairs. `FACE_SHADE` amorce déjà ce principe ; la V2 l'accentue et lui ajoute une occlusion
   ambiante cuite dans les sommets.

4. **La lumière est de la géométrie, pas des lampes.** Deux lumières réelles, comme aujourd'hui.
   Tout le reste — bandeaux néon, flash de bouche, lueur d'explosion, balise de ramassage — est
   une face additive ou une couleur de sommet émissive. Zéro recompilation de shader, zéro coût
   par pixel supplémentaire.

5. **Une silhouette se lit en un dixième de seconde.** Chaque archétype de bot a une forme de tête
   différente, visible de loin, avant même que la couleur soit discernable.

## Palettes par carte

| Carte | Neutres | Minéral | Ambiance |
|---|---|---|---|
| Arène Cendrée | cendre `#5a6270`, béton `#8d97aa` | cuivre `#c4713f` | crépuscule froid, ciel dégradé bleu-violet |
| Quartier Béton | béton chaud `#8d8577`, asphalte `#4c5150` | terre cuite `#c2734a` | fin d'après-midi, ombres longues |
| Bunker Halogène | acier `#6e7684`, sol sombre `#3f454e` | halogène `#7bf0d8` | intérieur, lumière artificielle froide |
| Crête Ocre | ocre `#9d7c4e`, roche sombre `#77613f` | sable clair `#c2a06a` | plein soleil, ciel cuivré, poussière |

Ces valeurs reprennent les couleurs existantes de `maps.js` — la DA les organise, elle ne les jette
pas.

## Ce qu'on évite explicitement

Pas de références à ShellShock (pas de tanks, pas de vue 2D, pas d'artillerie au tour par tour),
pas de style militaire réaliste, pas de textures photographiques. Les formes restent des boîtes.
Ce qui change, c'est la façon dont elles sont éclairées, teintées et détaillées.

---

# Armes V2

## Structure d'inventaire

Le catalogue passe à neuf armes, mais le joueur en porte toujours trois, composées avant la
partie. L'interface en jeu et les touches 1/2/3 ne bougent pas.

Les trois emplacements sont libres : n'importe laquelle des neuf armes peut aller dans n'importe
lequel. Un écran d'équipement dans le menu remplace le sélecteur d'arme unique actuel
(`cfg-weapon` dans `index.html`, câblé par `segWire` dans `menu.js`). Trois cases, chacune
ouvrant la liste des neuf armes avec sa fiche comparative.

Deux garde-fous d'équilibrage, appliqués au moment de la validation du menu :

- **Une seule arme par catégorie.** Pas de triple Lynx-M. Neuf armes réparties en huit catégories,
  la contrainte est naturelle et se vérifie en une ligne.
- **Un poids total maximum.** Chaque arme porte un champ `weight` (1 pour l'Éclisse-2, 3 pour le
  Tambour-7 et la Faille), et la somme des trois ne peut pas dépasser 6. Un joueur peut prendre
  Lynx-M + Cachet-30 + Éclisse-2, mais pas Tambour-7 + Faille + Cachet-30.

Les bots composent leur trio de la même façon, à partir de leur archétype : l'Éclaireur tire dans
le sous-ensemble courte portée, le Tireur autour du Lynx-M, et ainsi de suite. La contrainte de
catégorie s'applique aussi à eux.

## Le tableau

Dégâts par impact, cadence en coups/minute, portée en mètres.

| Nom | Catégorie | Rôle | Dég. | Cad. | Portée | Chargeur | Particularité | Apparence | Effets | Difficulté | Coût perf |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Éclisse-2** | Pistolet | Appoint léger | 24 | 380 semi | 45 | 14 / 70 | Recharge en 1,3 s, dispersion quasi nulle à l'arrêt, poids 1 | Compact, culasse ouverte, glissière teal | Flash court et net, douille éjectée, traçante fine | Faible | Très faible |
| **Guêpe-45** | Mitraillette | Pression rapprochée | 12 | 940 auto | 32 | 32 / 160 | Malus de dispersion en course réduit de moitié, recul latéral marqué | Très courte, crosse fil, chargeur incliné | Flash large et bref, cadence de douilles élevée | Faible | Très faible |
| **Rafale-9** | Fusil d'assaut | Référence polyvalente | 16 | 680 auto | 75 | 30 / 180 | Recul vertical régulier, contrôlable en rafales de 5 | Existante, retravaillée : garde-main ajouré, rail, viseur | Flash moyen, recul du modèle sur l'axe Z | Déjà là | Très faible |
| **Tambour-7** | Arme lourde | Tenue de zone | 18 | 720 auto | 70 | 100 / 200 | Montée en régime de 0,45 s ; la dispersion se resserre après 1 s de tir continu ; −25 % de vitesse en tirant | Barillet visible, boîtier de bande, bipied replié | Barillet qui tourne, flash continu pulsé, pluie de douilles | Moyenne | Faible |
| **Broyeur-12** | Fusil à pompe | Couloirs | 11 × 9 | 78 | 26 | 6 / 36 | Pompage animé entre deux coups, recharge cartouche par cartouche interruptible | Existant, retravaillé : pompe mobile, canon court, bois teinté | Flash en étoile, fumée de canon, 9 impacts groupés | Moyenne | Faible |
| **Lynx-M** | Sniper | Contrôle longue portée | 62 | 195 | 160 | 8 / 48 | Zoom ×2,4 ; immobile pendant 0,4 s = dispersion nulle | Existant, retravaillé : lunette tubulaire, bipied, crosse squelette | Traçante épaisse persistante 0,25 s, onde de bouche | Déjà là | Très faible |
| **Prisme** | Énergie | Faisceau soutenu | 9 par tick (20/s) | continu | 40 | 100 charge | Aucune dispersion, aucune chute de dégâts, surchauffe après 3 s puis 2 s de refroidissement | Bloc cristal, ailettes de dissipation, pas de chargeur | Faisceau additif continu, lueur qui vire au blanc avec la chaleur | Moyenne | Faible |
| **Faille** | Énergie à charge | Percée | 30 à vide → 95 chargé | 1 / 1,4 s | 200 | 4 / 16 | Charge de 0,9 s ; traverse jusqu'à 2 acteurs alignés | Long, rails parallèles, arc électrique entre les rails pendant la charge | Trait large et bref, recul caméra prononcé | Élevée | Faible |
| **Cachet-30** | Lance-projectiles | Zone et déni | 70 direct / 45 en zone (r = 3,2 m) | 55 | arc balistique | 4 / 12 | Projectile simulé, un rebond, fusée 1,6 s | Tube épais, hausse pliante, grenades visibles sur le côté | Projectile visible, explosion additive, fumée, poussée | Élevée | Moyenne |

## Ce qui rend chaque arme différente à l'usage

Les statistiques ne suffisent pas. Trois leviers supplémentaires, tous peu coûteux :

**Le recul est une courbe, pas un nombre.** Aujourd'hui `addRecoil` reçoit une valeur scalaire.
La V2 ajoute à chaque arme un motif de recul `recoilPattern: {up, side, rise}` : la Rafale-9 monte
droit, la Guêpe-45 part en zigzag latéral, le Tambour-7 monte lentement puis se stabilise, le
Broyeur-12 donne un à-coup unique et violent.

**Le son porte l'identité.** Les profils de `sfxShot` passent de trois entrées codées en dur dans
`audio.js` à un champ `sound` dans chaque définition d'arme : durée, fréquence de bande passante,
Q, niveau, fréquence du corps grave, et deux nouveaux paramètres — une queue de réverbération
courte pour les armes lourdes, et un composant métallique aigu pour les armes énergétiques.

**L'animation vend le poids.** Le modèle en vue subjective ne fait aujourd'hui que reculer et
plonger au rechargement. La V2 lui ajoute quatre animations lues depuis l'état de l'arme :
recul sur Z + rotation X, balancement de marche indexé sur `bobTime`, séquence de rechargement en
trois temps (chargeur qui sort, main qui remonte, culasse), et sortie/rentrée d'arme au changement.
Tout est piloté par des courbes dans `updateCamera`, sans système d'animation.

---

# Cartes V2

## Contrainte qui commande tout le reste

Le graphe de navigation échantillonne tous les 3 m et ne garde un nœud que si une capsule de
1,80 m y tient debout (`buildNav`, `world.js`). Conséquence pratique : **toute surface sur laquelle
un bot doit pouvoir marcher doit faire au moins 4 m de large**, sinon elle peut ne contenir aucun
nœud et devenir invisible pour l'IA. Les passerelles de 3 m du Quartier sont déjà à la limite.
Tout détail décoratif doit rester sous 0,62 m de haut (le step-up) ou dépasser franchement la
hauteur de tête, jamais entre les deux — sinon les bots s'y coincent.

Le détail décoratif ne coûte rien en draw calls puisqu'il fusionne dans la même géométrie. Il
coûte en sommets : chaque boîte ajoute 24 sommets et 36 indices. Une carte de 400 boîtes reste
sous les 10 000 sommets, ce qui est négligeable.

## Arène Cendrée

**Identité visuelle** — Béton cendré au crépuscule, structure métallique cuivrée, ciel dégradé
bleu-violet. Une arène couverte à moitié, éclairée par le côté.

**Améliorations** — Le sol de 54 × 54 m est découpé en dalles de 6 m avec trois variations de
teinte très proches (±4 % de luminosité), ce qui casse la surface plate sans ajouter de couleur.
Les gradins centraux reçoivent un liseré cuivre sur leur arête supérieure (boîte de 0,1 m).
Occlusion ambiante cuite dans les sommets au pied de chaque mur.

**Nouveaux éléments** — Poutrelles décoratives à 9 m au-dessus de l'arène (hors de portée, aucun
impact sur la nav), bannières verticales dans les angles, garde-corps ajourés sur les coursives
est/ouest, projecteurs éteints en géométrie fixée aux piliers.

**Codage des angles** — Chaque angle reçoit une teinte d'accent différente sur son pilier
(cuivre, vert-de-gris, ocre, ardoise). C'est la correction la plus utile de la carte : on sait
enfin où on est.

**Gameplay** — La plateforme centrale reste à 2,4 m. On ajoute deux couvertures basses à
mi-distance entre le centre et les coursives, pour que la traversée ne soit plus une exposition
totale.

**Risques bots** — Faibles. Les garde-corps doivent rester à 1,1 m (au-dessus du step-up, donc
infranchissables) et ne pas empiéter sur la largeur praticable de 5 m des coursives.

**Coût** — Très faible. Environ +90 boîtes, toujours 1 draw call.

## Quartier Béton

**Identité visuelle** — Béton chaud et bâches, fin d'après-midi, ombres portées longues. La carte
la plus « habitée » du jeu.

**Améliorations** — Les bâtiments reçoivent des ouvertures : allèges et linteaux en boîtes fines
qui créent de vraies fenêtres. Cela ouvre des lignes de vue depuis l'intérieur, ce qui manque
aujourd'hui puisque les murs sont pleins hors des portes. Bordures de toit marquées, descentes
d'eau verticales, blocs de ventilation sur les toits.

**Nouveaux éléments** — Enseignes émissives au-dessus de deux entrées (couleur de carte, jamais
orange ni teal), auvents en surplomb au-dessus des portes principales, palettes et bidons comme
couvertures basses, câbles tendus entre deux toits en boîtes très fines.

**Gameplay** — Les fenêtres transforment les bâtiments en positions de tir au lieu de simples
tunnels. Les passerelles passent de 3 m à 4 m de large pour garantir des nœuds de navigation.

**Risques bots** — Modérés, et c'est la carte à surveiller. Les appuis de fenêtre doivent être
soit sous 0,62 m, soit au-dessus de 1,8 m, jamais entre les deux. Les auvents ne doivent pas
générer de nœuds inaccessibles : un test de simulation de 60 s est indispensable ici.

**Coût** — Faible. Environ +160 boîtes.

## Bunker Halogène

**Identité visuelle** — Acier froid et halogène. Le seul intérieur du jeu, et la carte qui profite
le plus de la lumière artificielle.

**Améliorations** — Caissons lumineux au plafond (boîtes émissives, pas de lampes réelles),
plinthes émissives au sol le long des couloirs principaux, encadrements de porte marqués,
grilles de ventilation. Occlusion ambiante particulièrement marquée dans les angles — c'est un
intérieur, les coins doivent être sombres.

**Codage des quadrants** — Chaque quart de la grille reçoit une couleur d'accent sur ses
plinthes. Dans un dédale de couloirs identiques, c'est ce qui permet de s'orienter sans
mini-carte.

**Nouveaux éléments** — Portes blindées entrouvertes servant de couverture, casiers alignés le
long des murs, rambardes sur les coursives d'angle à 2,3 m.

**Gameplay** — Inchangé pour l'essentiel. Le Broyeur-12 y reste roi, et la nouvelle Guêpe-45 y
trouve naturellement sa place.

**Risques bots** — Le `sampleY = H - 0.5 = 4.1` doit rester tel quel. Tout élément ajouté au
plafond doit rester au-dessus de 4,1 m, sinon la sonde de sol le prend pour du sol et fait
apparaître bots et nœuds de navigation dessus. C'est l'invariant le plus fragile du projet.

**Coût** — Faible. Environ +130 boîtes.

## Crête Ocre

**Identité visuelle** — Plein soleil, ocre et sable, poussière en suspension, ciel cuivré. La
carte la plus ouverte, et celle qui a le plus besoin de profondeur atmosphérique.

**Améliorations** — Les rochers actuels sont des boîtes uniques ; ils deviennent des empilements
de 2 ou 3 boîtes décalées et légèrement tournées en couleur, ce qui suffit à lire une forme
naturelle. Strates horizontales sur les flancs des plateaux (bandes de 0,3 m en teinte voisine).
Brouillard ajusté pour bleuir légèrement au lointain plutôt que virer à la couleur du ciel.

**Nouveaux éléments** — Un anneau de mesas décoratives à l'extérieur des murs d'enceinte, fusionné
dans la même géométrie : coût nul en draw call, et la carte cesse d'être une boîte fermée. Piquets
et cordes le long des rampes, bosquets en trois boîtes au lieu d'une, poussière lente en
particules.

**Gameplay** — La crête centrale reste dominante mais gagne deux couvertures supplémentaires sur
ses flancs, pour qu'y monter ne soit plus un aller simple.

**Risques bots** — Faibles. Les empilements de rochers doivent conserver des faces verticales
franches, sinon le step-up de 0,62 m fait grimper les bots sur des formes prévues comme des
obstacles.

**Coût** — Faible. Environ +200 boîtes, dont une centaine hors zone jouable.

## Trois cartes nouvelles

### Silo Ardent — verticalité en extérieur

Quatre silos cylindriques approximés par des octogones de boîtes, reliés par des passerelles à
deux hauteurs (4 m et 8 m), autour d'une cour centrale. Palette rouille et acier, ciel de nuit
avec projecteurs. Le point haut domine tout mais n'a que deux accès, tous deux exposés.

Ouvert sur le dessus, donc `sampleY = 40` sans complication. Les passerelles font 4,5 m de large
pour la navigation. Difficulté : moyenne. Coût : faible.

### Verrière Pâle — intérieur lumineux

Une serre : plafond à 6,5 m, structure blanche, bacs de végétation émissifs verts, lumière
diffuse et haute. Le contraire visuel du Bunker — un intérieur clair. Longues allées droites
coupées par des bacs à hauteur de poitrine, deux mezzanines.

Carte fermée, donc `sampleY = 6.0` obligatoire. C'est exactement le piège documenté dans
`CLAUDE.md`. Difficulté : moyenne. Coût : faible.

### Jetée Saline — ouvert, longues lignes

Des quais, des conteneurs empilés en blocs de 2 à 3, deux grues portiques en géométrie, une eau
plate figurée par une grande boîte sombre légèrement émissive en bordure de carte. Palette bleu-gris
et conteneurs saturés (chacun une couleur franche, ce qui donne des repères naturels). Les
conteneurs forment un labyrinthe lisible en ligne droite — compatible avec la navigation sans A*.

Ouvert, `sampleY = 40`. Difficulté : faible, c'est la plus simple des trois à construire.
Coût : faible.

---

# Personnages et bots

## Le gain de performance d'abord

**Fait.** Chaque bot tient en **quatre** maillages fusionnés au lieu de neuf : jambe gauche, jambe
droite, buste (torse + bassin + tête + visière), bras + arme. Mesuré sur onze bots tous visibles :
**99 → 44 draw calls**, à triangles rigoureusement identiques.

Deux écarts avec le plan initial, tous deux assumés.

*Quatre groupes et non trois.* Les jambes restent séparées l'une de l'autre : le cycle de marche
décrit plus bas les fait osciller en opposition, ce qu'un bloc de jambes unique interdit. La
différence coûte un draw call par bot et évite de re-découper la géométrie au moment de l'animer.

*Couleur par sommet et non par matériau.* Un groupe fusionné mélange des teintes — le buste porte
la couleur du bot ET la visière `0x12161c`, le bras porte la couleur du bot ET le canon
`0x2b3038` — et un matériau uni ne sait pas rendre ça. La couleur passe donc dans les sommets,
exactement comme le décor dans `world.js`, ce qui fait que la géométrie est construite par bot et
non mise en cache par archétype. Ce sont quelques centaines de flottants par bot, construits une
fois à l'apparition, contre neuf `BoxGeometry` et neuf matériaux auparavant. Un seul
`MeshLambertMaterial({ vertexColors: true })` par bot sert ses quatre maillages ; il reste propre à
chaque bot pour que le flash de dégâts ci-dessous puisse monter l'émissive d'un bot sans toucher
aux autres.

La fusion elle-même vit dans `world.js` (`mergeBoxGeometry`), à côté de celle du décor : même
table de faces, même conversion sRGB → linéaire, pas de subdivision ni d'AO à cette échelle.

Ce gain finance tout ce qui suit.

## Lisibilité en combat

Un **chevron orange `#ff7a3c`** sur les deux épaules de tous les bots, quelle que soit leur couleur
d'équipe. C'est la règle de signal de la DA appliquée aux personnages : à 40 m, dans le contre-jour
de la Crête, on voit l'orange avant de voir la silhouette.

Une **ombre de contact** sous chaque acteur — un quad sombre orienté vers le haut, tous regroupés
dans un seul `BufferGeometry` mis à jour chaque frame, soit 1 draw call pour l'ensemble des
acteurs. Ça marche sur tous les préréglages, y compris `bas` où les vraies ombres sont coupées.
C'est l'amélioration qui ancre les personnages au sol.

Un **flash de dégâts** : l'émissive du matériau du bot monte à blanc pendant 0,08 s quand il est
touché. Le retour d'information de tir devient immédiat, même sans marqueur de coup.

`BOT_COLORS` est nettoyé de ses teintes proches du teal joueur et du cyan d'interface.

## Animation

Trois animations, toutes calculées à partir de l'état existant, sans squelette :

Les jambes oscillent autour de X en fonction de `speed2D` — deux lignes dans `syncMesh`. Le bras
suit déjà le tangage (`userData.arm.rotation.x`), on y ajoute un léger retard pour que la visée ne
soit pas instantanée. À la mort, le bot bascule sur 0,35 s au lieu de disparaître d'un coup : le
maillage reste visible pendant la chute, puis s'efface.

## Quatre archétypes

L'IA ne change pas. La machine à états, `sense`/`think`/`aim`/`shoot`/`move` restent exactement ce
qu'elles sont. Seuls des paramètres changent, plus une forme de tête distincte :

| Archétype | Arme | Comportement | Silhouette |
|---|---|---|---|
| **Assaut** | Rafale-9 | La référence actuelle, aucun changement | Tête cubique |
| **Éclaireur** | Guêpe-45 ou Broyeur-12 | `speedMul` ×1,15, distance idéale 6 m, strafe ×1,3, 80 PV | Tête basse et large, visière pleine largeur |
| **Tireur** | Lynx-M | `speedMul` ×0,85, distance idéale 30 m, strafe ×0,4, cherche les points hauts du graphe de nav | Tête haute, antenne verticale |
| **Lourd** | Tambour-7 | 150 PV, `speedMul` ×0,75, reste près des ramassages, `coverChance` réduit | Torse élargi, épaulières marquées |

La composition d'une partie devient un paramètre : par exemple 40 % Assaut, 30 % Éclaireur,
20 % Tireur, 10 % Lourd. Les difficultés existantes continuent de multiplier par-dessus.

Le point d'attention : les `if (def.id === 'broyeur')` de `bots.js` doivent disparaître au profit
d'un `idealRange` et d'un `maxEngageRange` lus dans la définition d'arme, sinon les six nouvelles
armes se comportent toutes comme une Rafale-9.

---

# Effets et ambiance

Tout ce qui suit est pooled, de taille fixe, alloué au démarrage de la partie. Aucune création
d'objet pendant le combat, comme aujourd'hui.

| Effet | Mise en œuvre | Coût |
|---|---|---|
| **Flash de bouche** | 3 quads additifs croisés, réutilisés, un jeu dans la scène monde + un dans la scène arme. Taille, couleur et durée lues dans la définition d'arme. C'est l'effet qui manque le plus. | Très faible |
| **Traçantes** | Le pool existant passe de 48 à 64, avec une épaisseur et une durée par arme. La Faille laisse un trait large de 0,25 s, la Guêpe-45 des traits fins et rapides. Les couleurs sont pré-converties une fois pour toutes, ce qui supprime le `new THREE.Color()` par tir. | Très faible |
| **Impacts** | Le pool d'étincelles passe à 220, avec une couleur dépendant du matériau touché (déduite de la couleur du sommet, déjà disponible dans la géométrie). Béton = gris clair, métal = étincelles jaunes. | Très faible |
| **Décalcomanies** | Pool de 96 quads d'impact orientés selon la normale, regroupés dans une seule `BufferGeometry` mise à jour par tranche. Les plus anciens sont recyclés. 1 draw call pour toutes les marques de la partie. | Faible |
| **Explosions** | Pour le Cachet-30 : une sphère additive qui grossit et s'efface sur 0,25 s, plus une bouffée de fumée et une secousse caméra proportionnelle à la distance. Les dégâts de zone utilisent `collision.blocked` pour vérifier la ligne de vue — la fonction existe déjà. | Faible |
| **Fumée** | Second pool de `Points`, 120 particules, matériau non additif, taille croissante et opacité décroissante. Utilisé par les explosions, la bouche du Broyeur-12 et la surchauffe du Prisme. | Faible |
| **Poussière** | Sur la Crête et la Jetée : 80 points très lents en suspension, repositionnés autour du joueur quand ils sortent d'un rayon de 25 m. Donne de la profondeur atmosphérique pour trois fois rien. Également au sol à l'atterrissage après un saut. | Très faible |
| **Douilles** | Pool de 48 petites boîtes fusionnées dans un seul maillage, physique simplifiée (gravité + un rebond, pas de collision réelle), éjectées par le modèle en vue subjective. Effet de présence très fort pour un coût dérisoire. | Très faible |
| **Dégâts stylisés** | Pas de sang. Un éclat de particules à la couleur de l'armure du bot touché (c'est déjà le comportement de `traceShot`), plus le flash blanc du matériau. Pour le joueur : vignette rouge directionnelle en DOM, donc gratuite côté GPU. | Très faible |
| **Éclairage** | Toujours deux lumières. Ce qui change : `ACESFilmicToneMapping` avec une exposition par carte, un ciel en dégradé (un `Mesh` sphérique inversé à couleur par sommet, 1 draw call), un brouillard dont la couleur diffère légèrement de celle du ciel, et une occlusion ambiante cuite dans les sommets au moment de la fusion géométrique. | Très faible en rendu, moyen en développement |
| **Ambiance sonore** | Une nappe de fond par carte (deux oscillateurs désaccordés filtrés, quelques lignes de WebAudio), des pas synthétisés indexés sur `bobTime`, une queue de réverbération courte pour les tirs en intérieur, et un panoramique stéréo selon l'angle de la source — `StereoPannerNode` est disponible partout et ne coûte rien. | Très faible |

L'occlusion ambiante mérite un mot. Elle se calcule une seule fois, à la construction de la carte,
dans `buildWorld` : pour chaque sommet, on teste la présence de solide dans quelques directions et
on assombrit la couleur du sommet en conséquence. Le coût au rendu est exactement zéro puisque la
couleur est déjà lue par le shader. Le coût au chargement est de quelques dizaines de millisecondes.
C'est le meilleur rapport qualité/prix de toute la V2.

---

# HUD et menu

Le HUD reste en DOM. Les ajouts retenus sont ceux qui répondent à une vraie question du joueur.

**Indicateur de direction des dégâts.** Un arc rouge qui apparaît du côté d'où vient le tir.
Aujourd'hui, `damageFlash()` allume un vignettage uniforme : le joueur sait qu'il est touché mais
pas d'où. C'est l'ajout le plus utile de la liste.

**Vignettage de vie basse.** En dessous de 30 PV, un liseré rouge pulsant en CSS, plus un
battement sourd en WebAudio. Zéro coût, information immédiate.

**Hauteur sur la mini-carte.** Les ennemis plus hauts que le joueur sont dessinés en anneau creux,
ceux plus bas en disque plein, les autres au niveau en disque plein cerclé. Sur une carte qui mise
sur la verticalité, c'est une information qui manque.

**Icônes d'arme.** Une petite silhouette SVG inline par arme dans les emplacements et dans le
killfeed. Générées à la main en quelques dizaines d'octets chacune, aucun fichier externe.

**Nombres de dégâts flottants.** Pool de 12 éléments DOM réutilisés, qui montent et s'effacent au
point d'impact projeté à l'écran. Optionnel dans les réglages.

**Écran de fin enrichi.** Précision, meilleure série, arme la plus efficace, temps en tête. Toutes
ces données existent déjà ou demandent deux compteurs supplémentaires dans `Weapon`.

**Menu.** Les vignettes de carte sont générées à partir de `minimapRects`, donc automatiquement,
sans image à maintenir. La fiche d'arme affiche des barres de comparaison (dégâts, cadence,
portée, maniabilité) calculées depuis `config.js` — le menu reste synchronisé avec l'équilibrage
tout seul.

Ce qu'on n'ajoute pas : roue d'armes, système de progression, défis, statistiques persistantes.
Rien de tout cela ne sert un FPS arcade hors-ligne.

---

# Classement des propositions

| Proposition | Impact visuel | Impact gameplay | Difficulté | Coût perf | Fichiers |
|---|---|---|---|---|---|
| Occlusion ambiante cuite | Très fort | Nul | Moyenne | Nul au rendu | `world.js` |
| Flash de bouche | Très fort | Moyen (ressenti) | Faible | Très faible | `effects.js`, `game.js`, `config.js` |
| Fusion des maillages de bots | Moyen | Nul | Moyenne | **Gain de ~70 draw calls** | `bots.js` |
| Ombres de contact | Fort | Faible | Faible | Très faible | `effects.js`, `game.js` |
| Tone mapping + exposition | Fort | Nul | Très faible | Très faible | `game.js`, `maps.js` |
| Ciel en dégradé | Fort | Nul | Faible | Très faible | `world.js`, `game.js` |
| Chevron orange sur les bots | Moyen | Fort | Très faible | Nul | `bots.js`, `config.js` |
| Détail de décor par carte | Fort | Faible | Moyenne | Très faible | `maps.js` |
| Six nouvelles armes | Moyen | Très fort | Élevée | Faible | `config.js`, `weapons.js`, `game.js`, `hud.js`, `index.html` |
| Modèles d'armes retravaillés | Très fort | Faible | Moyenne | Très faible | `weapons.js` |
| Animations d'arme | Fort | Moyen (ressenti) | Moyenne | Nul | `game.js`, `weapons.js` |
| Projectiles poolés | Moyen | Fort | Élevée | Faible | `game.js` (ou `projectiles.js`) |
| Décalcomanies d'impact | Moyen | Nul | Moyenne | Faible | `effects.js` |
| Fumée et poussière | Fort | Nul | Faible | Faible | `effects.js` |
| Douilles | Moyen | Nul | Faible | Très faible | `effects.js` |
| Archétypes de bots | Faible | Fort | Faible | Nul | `bots.js`, `config.js` |
| Direction des dégâts au HUD | Faible | Fort | Faible | Nul | `hud.js`, `style.css`, `index.html` |
| Trois cartes nouvelles | Fort | Fort | Moyenne | Faible | `maps.js` |
| Ambiance sonore | Faible | Moyen | Moyenne | Très faible | `audio.js`, `config.js` |

---

# Feuille de route

## V2.1 — amélioration rapide

Aucune refonte. Le jeu reste jouable à chaque étape.

1. ~~**Tone mapping et exposition par carte.**~~ **Fait.** `ACESFilmicToneMapping` dans
   `_setupRenderer`, mais l'exposition dans `_setupWorld` : le constructeur monte le renderer
   avant la carte, `mapData` n'existe pas encore à l'autre endroit. Un champ `exposure` par carte
   (1,10 / 1,22 / 1,20 / 1,10), calibré sur des captures au même point de vue pour retrouver la
   luminance perçue d'origine — la courbe creuse les noirs, le rattrapage les récupère. Mesuré :
   coût d'image nul (25,3 / 26,7 ips contre 25,8 / 26,1 sans).
2. ~~**Ciel en dégradé.**~~ **Fait.** `SphereGeometry` retournée, couleur par sommet, deux teintes
   par carte (`skyBottom` / `skyTop`), **un draw call** — et zéro sur `bunker`, qui n'en déclare
   pas : une carte couverte ne voit jamais son ciel. Le dégradé ne vit que dans l'hémisphère
   supérieur, sinon l'horizon serait déjà à 61 % de la teinte du zénith et le raccord se verrait.
   Ce ciel n'est pas qu'une décoration : il **répare** l'étape 1. `scene.background` est une
   couleur d'effacement, elle ne passe pas par le tone mapping, alors que le brouillard y passe —
   mesuré sur l'Arène, le mur lointain tombe de (17,27,44) à (3,11,27) pendant que le fond reste
   à (42,49,66). Un ciel en géométrie subit la même courbe que le brouillard vers lequel il se
   raccorde. Coût : environ 12 % d'images par seconde sous swiftshader, qui est un rasteriseur
   logiciel où le remplissage plein écran coûte cher ; sur un GPU, une passe plate de la taille de
   l'écran est de l'ordre de 2 % du budget d'image.
3. ~~**Occlusion ambiante cuite.**~~ **Fait.** `buildWorld` construit la collision d'abord, puis
   découpe chaque face en quads d'au plus `aoTile` mètres et assombrit chaque nœud selon le solide
   qui l'entoure (8 sondes `collision.overlaps`, plus un test grossier qui évite les sondes en
   terrain dégagé). La finesse devient un réglage de `QUALITY` : 1,7 m en `bas`, 0,9 m en `haut`.
   Mesuré : 29 à 98 ms de construction, 8,7k à 56k triangles selon la carte et le préréglage,
   toujours **un seul draw call**, graphe de navigation inchangé (277 / 613 / 340 / 726 nœuds).
4. ~~**Flash de bouche.**~~ **Fait.** Étoile à couleur de sommet (centre coloré, pourtour noir,
   additif) : aucune texture, un dégradé radial gratuit. Le joueur a la sienne accrochée à son
   arme, donc elle hérite du recul sans une ligne de synchronisation ; les bots passent par un pool
   de 16 dans `effects.js`, orienté face à la caméra à l'allumage. Taille, couleur et durée par
   arme (`muzzle` dans `config.js`). Mesuré : **+1 draw call**, 0 allocation par tir. Au passage,
   `muzzlePosition` faisait partir le coup du visage des bots au lieu de leur arme — invisible avec
   une traçante fine, flagrant avec un flash.
5. **Ombres de contact.** Un maillage unique de quads, mis à jour depuis la boucle de `game.js`.
6. ~~**Suppression des allocations de `THREE.Color` par tir.**~~ **Fait**, avec l'étape 4 : cache
   `hex → {r,g,b}` dans `effects.js`, rempli via `THREE.Color` pour conserver la conversion
   sRGB → linéaire de r169. `muzzlePosition` écrit désormais dans un objet réutilisé au lieu d'en
   allouer un par plomb.
7. **Chevron orange et nettoyage de `BOT_COLORS`.**
8. **Direction des dégâts et vignettage de vie basse.** `hud.js` et `style.css`.

## V2.2 — amélioration intermédiaire

9. **Séparation catalogue / inventaire.** `WEAPON_CATALOG` remplace l'usage double de
   `WEAPON_ORDER` ; `Loadout` reçoit une liste de trois identifiants au lieu de tout instancier.
   Les `(Math.random() * 3) | 0` de `bots.js` disparaissent. C'est le prérequis de tout ce qui suit.
10. **Les quatre armes hitscan nouvelles** : Éclisse-2, Guêpe-45, Tambour-7, Prisme. Définitions
    dans `config.js`, profils sonores associés, modèles en vue subjective.
11. **Modèles d'armes retravaillés** — les neuf, avec une fonction de construction par arme au lieu
    du modèle générique paramétré actuel. Environ 12 à 18 boîtes par arme au lieu de 6.
12. **Animations d'arme** : recul, balancement de marche, rechargement en trois temps, changement
    d'arme.
13. **Motifs de recul par arme**, avec `recoilPattern` dans `config.js`.
14. ~~**Fusion des maillages de bots.**~~ **Fait**, en quatre groupes et non trois (jambe gauche,
    jambe droite, buste, bras) pour garder le cycle de marche possible. Couleur par sommet via
    `mergeBoxGeometry` dans `world.js`, un matériau par bot. Mesuré : **9 → 4 draw calls par bot**,
    soit 99 → 44 à onze bots, triangles identiques (108 par bot), capture de contrôle identique au
    pixel près.
15. **Archétypes de bots** et remplacement des tests `def.id === 'broyeur'` par `idealRange`.
16. **Douilles, fumée, poussière.**
17. **Écran d'équipement au menu** : trois cases au lieu du sélecteur unique, fiches comparatives
    générées depuis `config.js`, contrôle de catégorie et de poids à la validation.
18. **Enrichissement des quatre cartes existantes**, une par une, avec une simulation de 60 s
    après chaque carte.

## V2.3 — transformation visuelle

19. **Projectiles poolés** et le Cachet-30 : liste fixe de 16 projectiles, intégration au sol
    par pas de simulation, dégâts de zone via `collision.blocked`.
20. **La Faille**, arme à charge avec pénétration de deux acteurs (le `traceShot` actuel s'arrête
    au premier).
21. **Explosions** : lueur additive, fumée, secousse caméra, poussée.
22. **Décalcomanies d'impact.**
23. **Les trois cartes nouvelles** : Jetée Saline d'abord (la plus simple), puis Silo Ardent, puis
    Verrière Pâle.
24. **Ambiance sonore** : nappes par carte, pas, réverbération d'intérieur, panoramique stéréo.
25. **Écran de fin enrichi et vignettes de carte générées.**

---

# Architecture et fichiers

## Fichiers modifiés

`js/config.js` — le fichier qui grossit le plus. Neuf définitions d'armes au lieu de trois, avec
les nouveaux champs (`recoilPattern`, `sound`, `idealRange`, `maxEngageRange`, `muzzle`,
`projectile`), la table des archétypes de bots, et la séparation `WEAPON_CATALOG` / emplacements.
Il passera de 162 à environ 450 lignes — c'est son rôle, tout l'équilibrage y vit.

`js/world.js` — occlusion ambiante cuite dans la boucle de fusion, construction du ciel en dégradé.
La fusion en une `BufferGeometry` unique ne change pas.

`js/maps.js` — détail des quatre cartes, trois cartes nouvelles, nouveaux helpers (`trim` pour les
liserés, `tiles` pour le pavage de sol, `rockCluster` pour les empilements), champs `exposure` et
`skyTop`/`skyBottom` par carte.

`js/effects.js` — pools supplémentaires : flash de bouche, fumée, poussière, douilles,
décalcomanies, ombres de contact. Table de couleurs pré-calculée. Le fichier reste organisé de la
même façon : tout est alloué au constructeur, rien pendant le combat.

`js/weapons.js` — un constructeur de modèle par arme, état de charge et de surchauffe pour les
armes énergétiques, rechargement cartouche par cartouche pour le Broyeur-12, `Loadout` qui accepte
trois identifiants.

`js/game.js` — tone mapping, tir des projectiles, dégâts de zone, animations du modèle d'arme.
C'est le fichier le plus gros (577 lignes) ; si la partie projectiles le fait dépasser 750, elle
sort dans son propre module.

`js/bots.js` — maillages fusionnés (fait), archétypes, `idealRange` au lieu des tests par
identifiant, animation des jambes, flash de dégâts, chute à la mort.

`js/hud.js`, `index.html`, `css/style.css` — direction des dégâts, vignettage, icônes d'armes,
hauteur sur la mini-carte, nombres de dégâts, écran de fin.

`js/audio.js` — profils sonores lus depuis `config.js`, nappes d'ambiance, pas, réverbération,
panoramique.

`js/menu.js` — écran d'équipement à trois cases parmi les neuf armes, fiches comparatives,
contrôle de catégorie et de poids. `js/settings.js` stocke désormais un tableau de trois
identifiants au lieu du champ `weapon` unique, avec une migration silencieuse pour les
`localStorage` existants (un ancien `weapon: 'rafale'` devient `['rafale', 'eclisse', 'lynx']`).

`CLAUDE.md` — à mettre à jour avec les nouveaux invariants : la règle des 4 m pour la navigation,
la règle du chevron orange, le fait que les couleurs de signal sont réservées.

## Fichiers nouveaux possibles

`js/projectiles.js` — si la simulation des projectiles dépasse la centaine de lignes dans
`game.js`. Pool fixe, intégration, détection d'impact par AABB.

`js/skybox.js` — probablement inutile : le ciel en dégradé tient en trente lignes dans `world.js`.
À ne créer que s'il grossit.

Aucun autre. Le projet doit rester petit et lisible, c'est une exigence du cahier des charges.

## Ce qui ne bouge pas

`js/collision.js`, `js/input.js`, `js/player.js`, `js/main.js`, `serve.py`.
Le step-up reste à 0,62 m, le pas de navigation à 3 m, le FOV de la caméra d'arme à 55, le HUD en
DOM, et il n'y a toujours aucune requête réseau.

## Livrable de cette étape

Ce document est écrit dans `docs/V2-CONCEPTION.md` et poussé sur la branche
`claude/keen-gates-ktjwb0`. Il sert de référence pendant l'implémentation, et chaque étape de la
feuille de route y est cochée au fur et à mesure. Aucun fichier de code n'est touché tant que
l'étape 1 n'est pas lancée.

---

# Priorités

Les dix premières choses à faire, dans l'ordre, en évitant de refaire ce qui marche déjà.

1. **Occlusion ambiante cuite dans les sommets** (`world.js`). Coût nul au rendu, c'est le
   changement le plus visible du lot.
2. **Flash de bouche poolé** (`effects.js`, `game.js`). Ce qui manque le plus à la sensation de tir.
3. ~~**Tone mapping ACES + exposition par carte**~~ (`game.js`, `maps.js`). **Fait**, coût nul.
4. ~~**Ciel en dégradé**~~ (`world.js`). **Fait** : un draw call sur les trois cartes ouvertes,
   zéro sur le Bunker, et les cartes extérieures cessent d'être des boîtes.
5. ~~**Fusion des maillages de bots**~~ (`bots.js`). **Fait** : 55 draw calls récupérés à onze
   bots (99 → 44), qui financent tout le reste.
6. **Ombres de contact** (`effects.js`). Ancre les acteurs au sol sur tous les préréglages, y
   compris `bas`.
7. **Séparation catalogue / inventaire** (`config.js`, `weapons.js`, `bots.js`). Prérequis
   obligatoire des nouvelles armes ; c'est aussi ce qui fait disparaître les `(Math.random()*3)|0`.
8. **Quatre armes hitscan nouvelles + modèles retravaillés** (`config.js`, `weapons.js`).
   Le gros du gain de variété, sans toucher au moteur de tir.
9. **Animations d'arme** (`game.js`). Recul, marche, rechargement, changement — le poids se
   ressent immédiatement.
10. **Chevron orange + direction des dégâts au HUD** (`bots.js`, `hud.js`). Les deux corrections de
    lisibilité qui changent le plus en combat, pour presque rien.

Les décalcomanies, les projectiles et les cartes nouvelles viennent après. Elles sont plus
ambitieuses et méritent une base déjà stabilisée.

---

# Vérification

À chaque étape, la même procédure, celle que `CLAUDE.md` impose déjà :

Lancer `./play.sh` et ouvrir `http://127.0.0.1:8000`. Faire tourner une simulation de 60 s sur
chacune des cartes avec Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, drapeaux
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`), et regarder quatre choses :
le nombre d'éliminations sur la durée (si les bots cessent de s'entretuer, la navigation est
cassée), les bots immobiles au point d'apparition, les acteurs passés sous le sol
(`pos.y < -30` déclenche déjà une mort), et la console.

Trois mesures à relever avant et après chaque étape : `renderer.info.render.calls` (la carte doit
rester à 1 draw call, les bots doivent descendre), `renderer.info.render.triangles`, et le compteur
d'images par seconde du HUD sur le préréglage `bas`, qui est la vraie cible du projet.

Pour les cartes, un contrôle supplémentaire : compter les nœuds du graphe de navigation avant et
après l'ajout de détail. Une chute brutale signale qu'un élément décoratif bloque une zone
praticable.
