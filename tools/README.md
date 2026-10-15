# Outils de vérification

Trois scripts pour contrôler qu'une modification n'a rien cassé. Ils servent au
développement et **ne font pas partie du jeu**.

Le jeu reste ce qu'il a toujours été : on ouvre `play.sh`, ça marche, sans npm,
sans build, sans rien installer. Rien de ce dossier n'est chargé par le
navigateur du joueur, et rien n'est ajouté à `index.html`.

## Pourquoi ces outils existent

`CLAUDE.md` demande de vérifier dans un vrai navigateur plutôt que par lecture,
et décrit précisément quoi regarder. Sans outil, chacun réécrit ce harnais à
chaque fois — et le réécrit mal, parce que deux ou trois pièges ne se voient
qu'en tombant dedans. Ils sont documentés dans le code, à l'endroit où ils
mordent.

## `geometrie.mjs` — le contrôle le moins cher

```bash
node tools/geometrie.mjs           # les trois préréglages
node tools/geometrie.mjs bas       # un seul
```

Ne demande que Node : `world.js` et `maps.js` n'utilisent de Three.js que des
`BufferGeometry` et des `Color`, qui ne touchent pas au DOM. Mesure les sommets,
les triangles, la mémoire d'attributs, le temps de construction et le nombre de
nœuds de navigation, et vérifie qu'aucune carte ne produit de valeur invalide ou
d'indice hors bornes.

À lancer d'abord après avoir touché à `world.js`, `maps.js` ou aux préréglages
de `config.js`. Il tourne en deux secondes.

**Le nombre de nœuds de navigation est le chiffre à surveiller.** Il ne dépend
que de la collision : toucher au rendu ne doit pas le faire bouger d'une unité.
Une chute signale une zone devenue impraticable, donc des bots qui n'iront plus
nulle part.

## `simulation.mjs` — le test qui a de la valeur

```bash
node tools/simulation.mjs                       # 60 s sur les 4 cartes
node tools/simulation.mjs --secondes=20         # plus court pendant qu'on itère
node tools/simulation.mjs --carte=bunker --qualite=haut
```

Fait jouer huit bots entre eux sur chaque carte et relève : les éliminations
(zéro = les bots ne se trouvent plus), les bots jamais sortis de leur point
d'apparition, les acteurs passés sous le décor, les draw calls du décor seul,
et les erreurs de console. Sort en erreur dès qu'un contrôle échoue.

## `captures.mjs` — comparer un avant et un après

```bash
node tools/captures.mjs --sortie=/tmp/avant
git stash && node tools/captures.mjs --sortie=/tmp/apres && git stash pop
```

Prend des images à position et angle fixes, bots et interface masqués, pour que
deux séries ne diffèrent que par ce qu'on a modifié. `--flash` allume le flash
de bouche ; `--qualite=bas` est le défaut, et c'est le seul préréglage sans
ombres portées, donc celui qui juge honnêtement l'éclairage cuit dans le décor.

## Installation

Seuls `simulation.mjs` et `captures.mjs` ont besoin de Chromium :

```bash
npm install -g playwright && npx playwright install chromium
```

`geometrie.mjs` n'a besoin de rien d'autre que Node. Si Playwright est absent,
les deux autres le disent en une phrase au lieu de vomir une pile d'appels.

## Trois pièges, et comment ils sont traités

**`renderer.info` ne retient que le dernier `render()`.** Le jeu rend deux
scènes par image, le monde puis l'arme : lire les draw calls après coup mesure
l'arme. `simulation.mjs` refait donc un rendu du monde seul. Et `info.render`
est une référence *vivante* — il faut recopier les valeurs avant le rendu
suivant, pas garder l'objet.

**La boucle rAF tourne même en pause.** `Game.update` saute la simulation quand
la partie est en pause, mais `main.js` continue d'appeler `render()`. Une
capture prise après un rendu manuel montre donc l'image du jeu, pas la vôtre —
et un flash de bouche allumé pour 45 ms est déjà éteint. `captures.mjs`
prolonge son compteur le temps de l'image.

**Le temps de jeu n'est pas le temps réel.** `TICK_MAX` plafonne le pas de
simulation à 1/30 s. En rendu logiciel, où l'on tourne à 15 images par seconde,
soixante secondes d'horloge ne font que trente secondes de jeu. `simulation.mjs`
attend donc sur `timeLeft`, jamais sur un `setTimeout`.

## Ce que ces outils ne disent pas

Les images par seconde qu'ils relèvent viennent d'un rendu logiciel
(swiftshader), qui calcule tout sur le processeur. Elles servent à comparer un
avant et un après, pas à juger du confort de jeu : un GPU intégré avale sans
broncher des dizaines de milliers de triangles qui font souffrir swiftshader.
Pour savoir si le jeu tient ses 60 images par seconde, il faut une vraie
machine.
