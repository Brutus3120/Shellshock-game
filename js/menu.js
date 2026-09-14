/**
 * menu.js — tous les écrans hors jeu : menu principal, choix de carte,
 * options, pause et fin de partie. Aucune dépendance : du DOM et un canvas 2D
 * pour dessiner les aperçus de carte directement depuis leur géométrie.
 */

import { MAP_INFO, buildMapData } from './maps.js';
import { settings, saveSettings, resetSettings } from './settings.js';
import { DIFFICULTIES } from './config.js';
import { rankingRows } from './hud.js';
import * as Sfx from './audio.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['screen-main', 'screen-maps', 'screen-options', 'screen-pause', 'screen-end', 'screen-loading', 'screen-click'];

export class Menu {
  constructor(handlers) {
    this.h = handlers;
    this.current = null;
    this.optionsFrom = 'screen-main';
    this._buildMapGrid();
    this._wire();
    this.syncFromSettings();
  }

  show(id) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
    this.current = id;
  }
  hideAll() { for (const s of SCREENS) $(s).classList.add('hidden'); this.current = null; }

  // --------------------------------------------------------------- vues ---

  _buildMapGrid() {
    const grid = $('map-grid');
    grid.innerHTML = '';
    this.cards = {};
    for (const info of MAP_INFO) {
      const card = document.createElement('button');
      card.className = 'map-card';
      card.innerHTML = `<canvas width="220" height="220"></canvas>
        <span class="tag">${info.tagline}</span>
        <h4>${info.name}</h4><p>${info.desc}</p>`;
      card.addEventListener('click', () => {
        settings.map = info.id; saveSettings(); Sfx.sfxUi();
        this._refreshMapSelection();
        this.show('screen-main');
      });
      grid.appendChild(card);
      drawMapThumb(card.querySelector('canvas'), info.id);
      this.cards[info.id] = card;
    }
  }

  _refreshMapSelection() {
    const info = MAP_INFO.find((m) => m.id === settings.map) || MAP_INFO[0];
    $('cfg-map').textContent = info.name;
    $('mp-name').textContent = info.name;
    $('mp-desc').textContent = info.desc;
    drawMapThumb($('map-preview'), info.id);
    for (const id in this.cards) this.cards[id].classList.toggle('on', id === settings.map);
  }

  /** Recopie les préférences dans les contrôles de l'interface. */
  syncFromSettings() {
    $('cfg-bots').value = settings.botCount;
    $('cfg-bots-val').textContent = settings.botCount;
    $('cfg-score').value = settings.scoreLimit;
    $('cfg-score-val').textContent = settings.scoreLimit === 0 ? '—' : settings.scoreLimit;
    seg('cfg-diff', settings.difficulty);
    seg('cfg-duration', String(settings.duration));
    seg('cfg-weapon', settings.weapon);
    seg('opt-quality', settings.quality);
    $('opt-sens').value = settings.sensitivity;
    $('opt-sens-val').textContent = Number(settings.sensitivity).toFixed(2);
    $('opt-fov').value = settings.fov;
    $('opt-fov-val').textContent = settings.fov + '°';
    $('opt-vol').value = settings.volume;
    $('opt-vol-val').textContent = Math.round(settings.volume * 100) + '%';
    $('opt-minimap').checked = settings.showMinimap;
    $('opt-fps').checked = settings.showFps;
    $('opt-invert').checked = settings.invertY;
    this._refreshMapSelection();
  }

  // -------------------------------------------------------------- liens ---

  _wire() {
    const click = (id, fn) => $(id).addEventListener('click', () => { Sfx.sfxUi(); fn(); });

    click('btn-play', () => this.h.onPlay(this.config()));
    click('btn-choose-map', () => this.show('screen-maps'));
    click('btn-maps-back', () => this.show('screen-main'));
    click('btn-options', () => { this.optionsFrom = 'screen-main'; this.show('screen-options'); });
    click('btn-opt-back', () => this.show(this.optionsFrom));
    click('btn-opt-reset', () => { resetSettings(); this.syncFromSettings(); this.h.onSettingsChanged(); });
    click('btn-quit', () => this.h.onQuit());

    click('btn-resume', () => this.h.onResume());
    click('btn-pause-options', () => { this.optionsFrom = 'screen-pause'; this.show('screen-options'); });
    click('btn-restart', () => this.h.onPlay(this.config()));
    click('btn-to-menu', () => this.h.onToMenu());
    click('btn-again', () => this.h.onPlay(this.config()));
    click('btn-end-menu', () => this.h.onToMenu());

    range('cfg-bots', (v) => { settings.botCount = v | 0; $('cfg-bots-val').textContent = settings.botCount; });
    range('cfg-score', (v) => {
      settings.scoreLimit = v | 0;
      $('cfg-score-val').textContent = settings.scoreLimit === 0 ? '—' : settings.scoreLimit;
    });
    range('opt-sens', (v) => { settings.sensitivity = v; $('opt-sens-val').textContent = v.toFixed(2); this.h.onSettingsChanged(); });
    range('opt-fov', (v) => { settings.fov = v | 0; $('opt-fov-val').textContent = (v | 0) + '°'; this.h.onSettingsChanged(); });
    range('opt-vol', (v) => { settings.volume = v; $('opt-vol-val').textContent = Math.round(v * 100) + '%'; this.h.onSettingsChanged(); });

    segWire('cfg-diff', (v) => { settings.difficulty = v; });
    segWire('cfg-duration', (v) => { settings.duration = parseInt(v, 10); });
    segWire('cfg-weapon', (v) => { settings.weapon = v; });
    segWire('opt-quality', (v) => { settings.quality = v; this.h.onSettingsChanged(true); });

    check('opt-minimap', (v) => { settings.showMinimap = v; this.h.onSettingsChanged(); });
    check('opt-fps', (v) => { settings.showFps = v; this.h.onSettingsChanged(); });
    check('opt-invert', (v) => { settings.invertY = v; });
  }

  config() {
    return {
      map: settings.map,
      botCount: settings.botCount,
      difficulty: settings.difficulty,
      duration: settings.duration,
      scoreLimit: settings.scoreLimit,
      weapon: settings.weapon,
    };
  }

  // ------------------------------------------------------- fin de partie ---

  showEnd(results, game) {
    const p = results.player;
    const rank = results.ranking.indexOf(p) + 1;
    const win = rank === 1;
    $('end-title').textContent = win ? 'VICTOIRE' : 'FIN DE PARTIE';
    $('end-title').style.color = win ? 'var(--ok)' : 'var(--accent)';
    const why = results.reason === 'score' ? "limite d'éliminations atteinte" : 'temps écoulé';
    $('end-summary').innerHTML =
      `Terminé — ${why}. Vous finissez <b>${rank}${rank === 1 ? 'er' : 'e'}</b> sur ${results.ranking.length}
       avec <b>${p.kills}</b> élimination(s) et <b>${p.deaths}</b> mort(s).
       Difficulté : <b>${DIFFICULTIES[game.opts.difficulty].label}</b>.`;
    $('end-body').innerHTML = rankingRows(game);
    this.show('screen-end');
  }
}

// ----------------------------------------------------------- utilitaires ---

function seg(id, value) {
  for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === value);
}
function segWire(id, fn) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    Sfx.sfxUi();
    for (const o of $(id).querySelectorAll('button')) o.classList.toggle('on', o === b);
    fn(b.dataset.v);
    saveSettings();
  });
}
function range(id, fn) {
  $(id).addEventListener('input', (e) => { fn(parseFloat(e.target.value)); saveSettings(); });
}
function check(id, fn) {
  $(id).addEventListener('change', (e) => { fn(e.target.checked); saveSettings(); });
}

/**
 * Aperçu d'une carte : vue de dessus dessinée à partir des boîtes elles-mêmes.
 * Les cartes n'ont donc aucune image à maintenir — modifier une carte met
 * automatiquement son aperçu à jour.
 */
export function drawMapThumb(canvas, mapId) {
  const data = buildMapData(mapId);
  const c = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const S = data.size + 6;
  const k = W / S;

  c.fillStyle = '#0a0d12';
  c.fillRect(0, 0, W, H);
  c.save();
  c.translate(W / 2, H / 2);
  c.scale(k, k);

  // Sol
  c.fillStyle = '#' + data.ground.toString(16).padStart(6, '0');
  c.globalAlpha = 0.35;
  c.fillRect(-data.size / 2, -data.size / 2, data.size, data.size);
  c.globalAlpha = 1;

  // Les boîtes, du plus bas au plus haut : la hauteur se lit par l'opacité.
  const boxes = data.boxes.filter((b) => b.h > 0.7 && b.y < 14).sort((a, b) => (a.y + a.h) - (b.y + b.h));
  for (const b of boxes) {
    const top = b.y + b.h;
    const a = Math.min(0.92, 0.25 + top / 12);
    c.fillStyle = '#' + b.color.toString(16).padStart(6, '0');
    c.globalAlpha = a;
    c.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
  }
  c.globalAlpha = 1;

  // Points de réapparition
  c.fillStyle = '#4fd1c5';
  for (const [x, z] of data.spawns) { c.beginPath(); c.arc(x, z, 1.1, 0, 6.283); c.fill(); }
  // Objets à ramasser
  for (const p of data.pickups) {
    c.fillStyle = p.type === 'health' ? '#7ddf64' : '#ffb347';
    c.fillRect(p.x - 0.9, p.z - 0.9, 1.8, 1.8);
  }
  c.restore();

  // Cadre
  c.strokeStyle = 'rgba(255,255,255,.08)';
  c.lineWidth = 1;
  c.strokeRect(0.5, 0.5, W - 1, H - 1);
}
