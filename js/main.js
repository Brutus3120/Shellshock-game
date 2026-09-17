/**
 * main.js — point d'entrée : assemble l'ATH, les menus et la partie,
 * et tient la boucle d'affichage.
 *
 * Le cycle de vie est volontairement simple : une partie = un objet Game,
 * détruit et recréé à chaque nouvelle partie. Pas d'état résiduel entre deux
 * manches, donc pas de bug qui n'apparaît qu'à la troisième partie.
 */

import { Game } from './game.js';
import { Hud } from './hud.js';
import { Menu } from './menu.js';
import { settings, loadSettings, saveSettings } from './settings.js';
import { QUALITY } from './config.js';
import * as Sfx from './audio.js';

const canvas = document.getElementById('view');

loadSettings();
Sfx.initAudio(settings.volume);

const hud = new Hud();
let game = null;
let state = 'menu';          // menu | playing | paused | ended
let clickArmed = false;

const menu = new Menu({
  onPlay: (config) => startGame(config),
  onResume: () => armClickToPlay(),
  onToMenu: () => toMenu(),
  onQuit: () => quit(),
  onSettingsChanged: (needsRestart) => applySettings(needsRestart),
});

menu.show('screen-main');

// ----------------------------------------------------------- cycle de vie ---

function startGame(config) {
  Sfx.resumeAudio();
  menu.show('screen-loading');
  if (game) { game.dispose(); game = null; }

  // Laisse le navigateur afficher l'écran de chargement avant de bloquer
  // le fil principal pour construire la carte.
  requestAnimationFrame(() => setTimeout(() => {
    saveSettings();
    game = new Game(canvas, config, settings, hud);
    game.onEnd = (results) => {
      state = 'ended';
      hud.scoreboard(false, game);
      menu.showEnd(results, game);
    };
    game.onPauseRequest = () => game.input.releaseLock();
    game.input.onLockChange = onLockChange;
    game.updateViewModel();
    game.start();
    state = 'playing';
    armClickToPlay();
  }, 30));
}

/**
 * La capture de la souris exige un geste de l'utilisateur, et le navigateur
 * impose un court délai après une sortie par Échap : on demande donc toujours
 * le verrouillage depuis un clic explicite.
 */
function armClickToPlay() {
  if (!game) return;
  game.paused = true;
  menu.show('screen-click');
  if (clickArmed) return;
  clickArmed = true;
  const handler = () => {
    document.removeEventListener('mousedown', handler);
    clickArmed = false;
    Sfx.resumeAudio();
    // La partie a pu disparaître entre l'armement et le clic : un retour au
    // menu principal fait game = null, et le clic suivant tombait ici.
    if (game) game.input.requestLock();
  };
  document.addEventListener('mousedown', handler);
}

function onLockChange(locked) {
  if (!game || state === 'ended') return;
  if (locked) {
    game.paused = false;
    state = 'playing';
    menu.hideAll();
    hud.show(true);
  } else if (state === 'playing') {
    game.paused = true;
    state = 'paused';
    hud.scoreboard(false, game);
    menu.show('screen-pause');
  }
}

function toMenu() {
  if (game) { game.dispose(); game = null; }
  state = 'menu';
  hud.show(false);
  menu.syncFromSettings();
  menu.show('screen-main');
}

function quit() {
  if (game) { game.dispose(); game = null; }
  hud.show(false);
  menu.hideAll();
  window.close();     // ne fonctionne que si l'onglet a été ouvert par un script
  document.body.innerHTML =
    '<div style="display:flex;height:100%;align-items:center;justify-content:center;' +
    'flex-direction:column;gap:10px;color:#8b97a8;font-family:system-ui">' +
    '<h1 style="color:#e6ecf3;letter-spacing:.3em;margin:0">ÉCLAT</h1>' +
    '<p>Partie quittée. Vous pouvez fermer cet onglet.</p>' +
    '<button onclick="location.reload()" style="padding:10px 18px;border-radius:8px;cursor:pointer;' +
    'background:#4fd1c5;color:#06201d;border:0;font-weight:700">RELANCER</button></div>';
}

function applySettings(needsRestart) {
  Sfx.setVolume(settings.volume);
  hud.setOptions(settings);
  if (game) {
    if (needsRestart) {
      game.quality = QUALITY[settings.quality] || QUALITY.moyen;
      game.resize();          // la résolution s'applique tout de suite ;
    }                         // les ombres, elles, à la prochaine partie.
    game.camera.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------- boucle ---

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!game) return;
  game.update(dt);
  game.render();
}
requestAnimationFrame(frame);

// Divers : le menu contextuel gênerait la visée au clic droit.
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (e.code === 'F5' && state === 'playing') return;   // on laisse recharger
});

// Expose un minimum pour le débogage depuis la console du navigateur.
window.ECLAT = { get game() { return game; }, settings, menu };
