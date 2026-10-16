/**
 * simulation.mjs — le test qui a de la valeur : faire tourner une vraie partie.
 *
 * `CLAUDE.md` demande de vérifier dans un vrai navigateur, pas par lecture.
 * Cet outil fait jouer les bots entre eux sur chaque carte et relève ce qui
 * révèle une régression :
 *
 *   éliminations    zéro = les bots ne se trouvent plus (navigation cassée)
 *   bots bloqués    un bot qui n'a jamais quitté son point d'apparition
 *   sous le sol     un acteur passé à travers le décor
 *   draw calls      le décor doit rester à 1, quoi qu'on ajoute
 *   erreurs console tout ce que le navigateur a signalé
 *
 *   node tools/simulation.mjs                 # 60 s sur les 4 cartes, préréglage bas
 *   node tools/simulation.mjs --secondes=20   # plus court pendant qu'on itère
 *   node tools/simulation.mjs --carte=bunker --qualite=haut
 *
 * Sort en erreur dès qu'un de ces contrôles échoue, pour être utilisable tel
 * quel dans un enchaînement automatique.
 */

import { chargerPlaywright, ouvrirNavigateur, demarrerServeur, DEMARRER_PARTIE } from './navigateur.mjs';

const args = Object.fromEntries(process.argv.slice(2)
  .filter((a) => a.startsWith('--'))
  .map((a) => { const [k, v = 'true'] = a.slice(2).split('='); return [k, v]; }));

const SECONDES = Number(args.secondes || 60);
const QUALITE = args.qualite || 'bas';          // le préréglage que vise le projet
const DUREE = 300;                              // durée du match, en secondes de jeu
const CARTES = args.carte ? [args.carte] : ['arene', 'quartier', 'bunker', 'crete'];

const playwright = await chargerPlaywright();
const serveur = await demarrerServeur();
const navigateur = await ouvrirNavigateur(playwright);
let echecs = 0;

console.log(`Simulation de ${SECONDES} s de jeu, préréglage « ${QUALITE} », sur ${serveur.url}`);
console.log('carte      jeu    élims  décor  draw  tris    bloqués  sous-sol  fps  erreurs');
console.log('─'.repeat(78));

for (const carte of CARTES) {
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 720 } });
  const erreurs = [];
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  page.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message));

  await page.goto(serveur.url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.ECLAT && window.ECLAT.menu);

  await page.evaluate(new Function('return ' + DEMARRER_PARTIE)(),
    { map: carte, quality: QUALITE, botCount: 8, difficulty: 'normal', duration: DUREE, scoreLimit: 0 });

  // On relève en continu : un acteur peut traverser le sol puis réapparaître,
  // et un contrôle unique à la fin ne verrait rien.
  await page.evaluate(() => {
    const g = window.ECLAT.game;
    window.__releve = {
      sousSol: 0,
      depart: g.bots.map((b) => ({ x: b.pos.x, z: b.pos.z })),
      parcouru: g.bots.map(() => 0),
    };
    const pas = () => {
      const jeu = window.ECLAT.game; if (!jeu) return;
      const r = window.__releve;
      for (let i = 0; i < jeu.bots.length; i++) {
        const b = jeu.bots[i];
        if (b.pos.y < -5) r.sousSol++;
        const d = r.depart[i];
        r.parcouru[i] = Math.max(r.parcouru[i], Math.hypot(b.pos.x - d.x, b.pos.z - d.z));
      }
      if (jeu.player.pos.y < -5) r.sousSol++;
      setTimeout(pas, 100);
    };
    pas();
  });

  // On attend du TEMPS DE JEU et non du temps réel : TICK_MAX plafonne le pas
  // de simulation, donc en rendu logiciel le jeu avance moins vite que l'horloge.
  await page.waitForFunction(
    ([d, s]) => window.ECLAT.game && (d - window.ECLAT.game.timeLeft) >= s,
    [DUREE, SECONDES], { timeout: 20 * 60 * 1000, polling: 500 }
  );

  const r = await page.evaluate(() => {
    const g = window.ECLAT.game;
    // `renderer.info` ne retient que le DERNIER render() : la scène de l'arme
    // écrase celle du monde. On refait donc un rendu du monde seul pour mesurer.
    g.renderer.render(g.scene, g.camera);
    // `info.render` est une référence VIVANTE : il faut recopier maintenant,
    // sinon le rendu suivant écrase ces valeurs avant qu'on les lise.
    const draw = g.renderer.info.render.calls;
    const tris = g.renderer.info.render.triangles;
    // Le décor seul : on masque tout le reste le temps d'une mesure.
    const caches = [];
    g.scene.traverse((o) => {
      if ((o.isMesh || o.isPoints || o.isLine) && o !== g.world.mesh && o.visible) {
        o.visible = false; caches.push(o);
      }
    });
    g.renderer.render(g.scene, g.camera);
    const decor = g.renderer.info.render.calls;
    for (const o of caches) o.visible = true;

    return {
      jeu: +(300 - g.timeLeft).toFixed(1),
      elims: g.actors.reduce((s, a) => s + a.kills, 0),
      decor, draw, tris,
      bloques: window.__releve.parcouru.filter((m) => m < 2).length,
      bots: g.bots.length,
      sousSol: window.__releve.sousSol,
      fps: g.hud.fpsValue,
    };
  });

  const mauvais = erreurs.length > 0 || r.sousSol > 0 || r.bloques > 0 || r.elims === 0 || r.decor !== 1;
  if (mauvais) echecs++;
  console.log(
    `${carte.padEnd(11)}${(r.jeu + 's').padStart(6)}${String(r.elims).padStart(7)}` +
    `${String(r.decor).padStart(7)}${String(r.draw).padStart(6)}${String(r.tris).padStart(8)}` +
    `${(r.bloques + '/' + r.bots).padStart(9)}${String(r.sousSol).padStart(10)}` +
    `${String(r.fps).padStart(5)}${String(erreurs.length).padStart(9)}` +
    (mauvais ? '   ← À VOIR' : '')
  );
  for (const e of erreurs.slice(0, 5)) console.log('    ! ' + e);
  await page.close();
}

console.log('─'.repeat(78));
await navigateur.close();
serveur.arreter();

if (echecs) {
  console.error(`${echecs} carte(s) en défaut.`);
  process.exit(1);
}
console.log('Aucune régression détectée.');
console.log('Rappel : les images par seconde relevées ici viennent d\'un rendu');
console.log('logiciel. Elles servent à comparer avant/après, pas à juger du');
console.log('confort de jeu sur une vraie machine.');
