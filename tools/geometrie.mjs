/**
 * geometrie.mjs — mesure le coût géométrique des cartes, hors navigateur.
 *
 * Ne demande que Node : `world.js` et `maps.js` n'utilisent de Three.js que des
 * `BufferGeometry` et des `Color`, qui ne touchent pas au DOM. C'est donc le
 * contrôle le moins cher du lot, et celui à lancer d'abord après avoir touché à
 * `world.js`, `maps.js` ou aux préréglages de `config.js`.
 *
 *   node tools/geometrie.mjs              # les trois préréglages
 *   node tools/geometrie.mjs bas          # un seul
 *
 * Sort en erreur si une carte produit des coordonnées ou des couleurs
 * invalides, ou des indices hors des sommets alloués.
 */

import { MAP_ORDER, buildMapData } from '../js/maps.js';
import { buildWorld } from '../js/world.js';
import { QUALITY } from '../js/config.js';

const presets = process.argv[2] ? [process.argv[2]] : ['bas', 'moyen', 'haut'];
let echecs = 0;

console.log('préréglage carte       sommets  triangles  attributs   nav   build');
console.log('─'.repeat(70));

for (const q of presets) {
  if (!QUALITY[q]) { console.error(`préréglage inconnu : ${q}`); process.exit(2); }
  for (const id of MAP_ORDER) {
    const carte = buildMapData(id);
    const t0 = performance.now();
    const monde = buildWorld(carte, QUALITY[q]);
    const ms = performance.now() - t0;

    const pos = monde.geometry.attributes.position;
    const couleurs = monde.geometry.attributes.color.array;
    const indices = monde.geometry.index.array;

    // Intégrité : une seule valeur non finie suffit à faire disparaître une
    // carte entière à l'écran, et c'est muet dans la console du navigateur.
    let invalides = 0;
    for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) invalides++;
    for (let i = 0; i < couleurs.length; i++) if (!Number.isFinite(couleurs[i])) invalides++;
    let maxIdx = 0;
    for (let i = 0; i < indices.length; i++) if (indices[i] > maxIdx) maxIdx = indices[i];

    const probleme = invalides > 0 || maxIdx !== pos.count - 1;
    if (probleme) echecs++;

    const mo = (pos.array.byteLength * 3 + indices.byteLength) / 1048576;
    console.log(
      `${q.padEnd(11)}${id.padEnd(11)}${String(pos.count).padStart(8)}` +
      `${String(indices.length / 3).padStart(11)}${(mo.toFixed(2) + ' Mo').padStart(11)}` +
      `${String(monde.nav.nodes.length).padStart(6)}${(ms.toFixed(0) + ' ms').padStart(8)}` +
      (probleme ? `   ← ${invalides} valeur(s) invalide(s), indice max ${maxIdx}/${pos.count - 1}` : '')
    );
  }
}

console.log('─'.repeat(70));
if (echecs) {
  console.error(`${echecs} carte(s) en défaut.`);
  process.exit(1);
}
console.log('Géométrie saine.');
console.log('Le nombre de nœuds de navigation ne doit pas bouger quand on touche');
console.log('au rendu : il ne dépend que de la collision. Une chute signale une');
console.log("zone devenue impraticable, donc des bots qui n'iront plus nulle part.");
