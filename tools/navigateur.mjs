/**
 * navigateur.mjs — plomberie partagée par les outils de vérification.
 *
 * Deux choses, et rien d'autre : lancer `serve.py` en récupérant le port qu'il
 * a réellement pris, et ouvrir un Chromium piloté.
 *
 * ATTENTION : Playwright est un outil de DÉVELOPPEMENT. Le jeu, lui, n'a
 * toujours aucune dépendance en dehors de Three.js vendoré, et continue de
 * tourner en ouvrant `play.sh` sans rien installer. Rien de ce dossier n'est
 * chargé par le navigateur du joueur.
 */

import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Playwright n'est pas dans le dépôt : on le cherche là où il peut être.
 * Message explicite plutôt qu'une pile d'appels si on ne le trouve pas.
 */
export async function chargerPlaywright() {
  const candidats = ['playwright'];
  try {
    const global = execFileSync('npm', ['root', '-g'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (global) candidats.push(path.join(global, 'playwright', 'index.mjs'));
  } catch { /* npm absent : on tentera les autres pistes */ }
  candidats.push('/opt/node22/lib/node_modules/playwright/index.mjs');

  for (const c of candidats) {
    try { return await import(c); } catch { /* piste suivante */ }
  }
  throw new Error(
    'Playwright est introuvable. Ces outils sont facultatifs et servent au\n' +
    "développement ; le jeu n'en a pas besoin. Pour les utiliser :\n" +
    '    npm install -g playwright && npx playwright install chromium'
  );
}

/**
 * Chromium en rendu logiciel : ces drapeaux sont ceux qui marchent sur une
 * machine sans GPU (intégration continue, conteneur). Sur un poste avec GPU on
 * peut les retirer, le rendu sera simplement plus rapide.
 */
export async function ouvrirNavigateur(playwright) {
  const options = {
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--no-sandbox', '--disable-dev-shm-usage'],
  };
  try {
    return await playwright.chromium.launch(options);
  } catch (e) {
    // Installation hors des chemins connus de Playwright : on tente les
    // emplacements habituels avant d'abandonner.
    const racineNav = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const pistes = racineNav ? [path.join(racineNav, 'chromium')] : [];
    for (const p of pistes) {
      try { return await playwright.chromium.launch({ ...options, executablePath: p }); } catch { /* suivante */ }
    }
    throw e;
  }
}

/**
 * Démarre `serve.py` et rend son URL. Le serveur replie sur 20 ports si 8000
 * est pris, donc on lit le port qu'il annonce au lieu de le supposer.
 */
export function demarrerServeur() {
  const proc = spawn('python3', [path.join(RACINE, 'serve.py'), '--no-open'], {
    cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Si l'outil s'arrête en erreur avant d'appeler arreter(), le serveur ne doit
  // pas rester derrière et bloquer le port au lancement suivant.
  process.on('exit', () => proc.kill());
  return new Promise((resolve, reject) => {
    const minuteur = setTimeout(() => reject(new Error("serve.py n'a pas démarré en 10 s")), 10000);
    let tampon = '';
    proc.stdout.on('data', (d) => {
      tampon += d.toString();
      const m = tampon.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        clearTimeout(minuteur);
        resolve({ url: m[0], arreter: () => proc.kill() });
      }
    });
    proc.on('error', (e) => { clearTimeout(minuteur); reject(e); });
    proc.on('exit', (code) => { clearTimeout(minuteur); reject(new Error(`serve.py a quitté (code ${code})`)); });
  });
}

/**
 * Démarre une partie et débloque la simulation.
 *
 * Le verrouillage du pointeur exige un geste utilisateur, impossible à produire
 * ici : on force donc l'état « en jeu » que `Game.update` attend. C'est le seul
 * endroit où ces outils touchent aux entrailles du jeu.
 */
export const DEMARRER_PARTIE = `async (config) => {
  const E = window.ECLAT;
  Object.assign(E.settings, config);
  E.menu.h.onPlay(E.menu.config());
  await new Promise((r) => { const attendre = () => (window.ECLAT.game ? r() : setTimeout(attendre, 20)); attendre(); });
  const g = window.ECLAT.game;
  g.paused = false;
  Object.defineProperty(g.input, 'locked', { value: true, writable: true, configurable: true });
  return true;
}`;
