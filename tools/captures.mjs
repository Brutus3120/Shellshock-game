/**
 * captures.mjs — images à caméra fixe, pour comparer un avant et un après.
 *
 * Une capture prise en cours de partie ne prouve rien : la position du joueur,
 * celle des bots et l'éclairage changent d'une fois sur l'autre. Cet outil fige
 * tout — même carte, même point de vue, même angle, bots masqués — pour que
 * deux images ne diffèrent que par ce qu'on a modifié.
 *
 *   node tools/captures.mjs --sortie=/tmp/avant
 *   git stash && node tools/captures.mjs --sortie=/tmp/apres && git stash pop
 *
 *   --qualite=bas    préréglage (défaut : bas, celui que vise le projet ;
 *                    c'est aussi le seul sans ombres portées, donc celui qui
 *                    juge honnêtement l'éclairage cuit)
 *   --flash          allume le flash de bouche sur les captures d'arme
 */

import path from 'node:path';
import { chargerPlaywright, ouvrirNavigateur, demarrerServeur, DEMARRER_PARTIE, RACINE } from './navigateur.mjs';

const args = Object.fromEntries(process.argv.slice(2)
  .filter((a) => a.startsWith('--'))
  .map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));

const SORTIE = path.resolve(args.sortie || path.join(RACINE, 'captures'));
const QUALITE = args.qualite || 'bas';
const FLASH = args.flash === 'true';

/**
 * Points de vue choisis pour ce qu'ils montrent, pas au hasard :
 * un angle mur/sol, un escalier (empilement de boîtes), un couloir fermé,
 * et une rue dégagée.
 */
const VUES = [
  { carte: 'arene', nom: 'angle', x: -18, z: -18, yaw: -2.356, pitch: -0.10 },
  { carte: 'arene', nom: 'escalier', x: 17, z: 0, yaw: 1.5708, pitch: -0.18 },
  { carte: 'bunker', nom: 'couloir', x: 7, z: 22, yaw: 0, pitch: -0.04 },
  { carte: 'quartier', nom: 'rue', x: 0, z: 30, yaw: 0, pitch: -0.08 },
  { carte: 'crete', nom: 'crete', x: 0, z: 28, yaw: 0, pitch: -0.06 },
];

const playwright = await chargerPlaywright();
const serveur = await demarrerServeur();
const navigateur = await ouvrirNavigateur(playwright);
const page = await navigateur.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', (e) => console.error('pageerror: ' + e.message));

await page.goto(serveur.url, { waitUntil: 'load' });
await page.waitForFunction(() => window.ECLAT && window.ECLAT.menu);

let carteCourante = null;
for (const v of VUES) {
  if (v.carte !== carteCourante) {
    await page.evaluate(new Function('return ' + DEMARRER_PARTIE)(),
      { map: v.carte, quality: QUALITE, botCount: 0, difficulty: 'normal', duration: 300, scoreLimit: 0 });
    carteCourante = v.carte;
  }

  const mesure = await page.evaluate(({ v, flash }) => {
    const g = window.ECLAT.game;
    g.paused = true;                       // plus rien ne bouge
    window.ECLAT.menu.hideAll();
    document.getElementById('hud').classList.add('hidden');
    for (const b of g.bots) b.mesh.visible = false;

    g.player.pos.x = v.x; g.player.pos.z = v.z;
    g.player.pos.y = g.groundAt(v.x, v.z) + 0.05;
    g.player.yaw = v.yaw; g.player.pitch = v.pitch;
    g.player.recoilPitch = 0; g.player.recoilYaw = 0;

    // La boucle rAF du jeu continue de tourner même en pause, et re-rendra la
    // scène après nous. Un flash allumé pour 45 ms serait éteint avant que la
    // capture soit prise : on prolonge son compteur le temps de l'image.
    if (flash) { g.fireShot(g.player, g.player.loadout.current, 1); g.vmFlash = 10; }
    g.updateCamera(0.016);

    g.renderer.clear();
    g.renderer.render(g.scene, g.camera);
    const decor = g.renderer.info.render.calls;
    if (g.player.alive) { g.renderer.clearDepth(); g.renderer.render(g.vmScene, g.vmCamera); }
    return { decor };
  }, { v, flash: FLASH });

  const fichier = path.join(SORTIE, `${v.carte}-${v.nom}.png`);
  await page.screenshot({ path: fichier });
  console.log(`${v.carte}/${v.nom} → ${fichier}  (scène monde : ${mesure.decor} draw calls)`);
}

await navigateur.close();
serveur.arreter();
console.log(`\n${VUES.length} captures dans ${SORTIE}`);
