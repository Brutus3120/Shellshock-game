/**
 * hud.js — l'ATH. Tout est en DOM : le GPU n'en voit rien, et le texte reste
 * net quelle que soit la résolution de rendu (qui, elle, peut être réduite).
 * Seule la mini-carte utilise un canvas 2D, rafraîchi à 15 Hz et pas à 60.
 */

import { WEAPONS, SLOT_COUNT } from './config.js';

const $ = (id) => document.getElementById(id);

const DIR_LIFE = 1.15;      // durée d'un arc de direction, avant fondu (s)
const LOW_HP_ON = 30;       // vie en dessous de laquelle la vignette s'allume
const LOW_HP_OFF = 35;      // ...et au-dessus de laquelle elle s'éteint

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      time: $('hud-time'), kills: $('hud-kills'), deaths: $('hud-deaths'), rank: $('hud-rank'),
      hpValue: $('hp-value'), hpFill: $('hp-fill'),
      ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'), ammoRow: $('ammo-row'),
      weaponName: $('weapon-name'), slots: document.querySelectorAll('#weapon-slots .slot'),
      reloadHint: $('reload-hint'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      flash: $('damage-flash'), killfeed: $('killfeed'), minimap: $('minimap'),
      lowhp: $('lowhp'), dirs: document.querySelectorAll('#damage-dir i'),
      fps: $('fps-counter'), respawn: $('respawn-overlay'), respawnBy: $('respawn-by'),
      respawnTimer: $('respawn-timer'), scoreboard: $('scoreboard'), sbBody: $('sb-body'),
      mini: $('leaderboard-mini'),
    };
    this.ctx = this.el.minimap.getContext('2d');
    this.minimapTimer = 0;
    this.hitTimer = 0;
    this.flashTimer = 0;
    this.feed = [];
    this.fpsAccum = 0; this.fpsFrames = 0; this.fpsValue = 0;
    this._lastSlot = -1;
    // Arcs de direction : un pool, comme les effets 3D. On n'ajoute ni ne
    // retire jamais un nœud en plein combat.
    this.dirs = Array.from(this.el.dirs).map((el) => ({ el, t: 0, angle: 0 }));
    this._lowHp = false;

    // Étiquettes des cases : écrites depuis l'inventaire du joueur dans update(),
    // pas ici. La classe Hud vit toute la session et survit aux parties, alors
    // que l'inventaire appartient à une partie.
    this._slotIds = new Array(SLOT_COUNT).fill(null);
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  setOptions(opts) {
    this.el.minimap.classList.toggle('hidden', !opts.showMinimap);
    this.el.fps.classList.toggle('hidden', !opts.showFps);
  }

  // ------------------------------------------------------------ signaux ---

  hitMarker(kill) {
    const h = this.el.hitmarker;
    h.classList.remove('show', 'kill');
    void h.offsetWidth;                     // force le redémarrage de l'animation
    h.classList.add('show');
    if (kill) h.classList.add('kill');
  }

  damageFlash() {
    this.el.flash.classList.add('on');
    this.flashTimer = 0.05;
  }

  /**
   * Arc de direction d'un coup reçu. `angle` est en degrés dans le repère de
   * la CAMÉRA : 0 droit devant, positif vers la droite — le sens de `rotate()`
   * en CSS, donc rien à convertir.
   *
   * Une rafale de trois balles du même bot ne doit pas consommer trois arcs :
   * si un arc encore vivant pointe à moins de 20°, on le rafraîchit. Sinon on
   * prend le plus ancien du pool.
   */
  damageFrom(angle) {
    let slot = null;
    for (const d of this.dirs) {
      if (d.t > 0 && Math.abs(angleDiff(d.angle, angle)) < 20) { slot = d; break; }
    }
    if (!slot) slot = this.dirs.reduce((a, b) => (b.t < a.t ? b : a));
    slot.angle = angle;
    slot.t = DIR_LIFE;
    slot.el.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    slot.el.classList.add('on');
  }

  killFeed(killerName, victimName, weaponName, playerIsKiller, playerIsVictim) {
    const div = document.createElement('div');
    div.className = 'kf' + (playerIsKiller ? ' me' : (playerIsVictim ? ' victim' : ''));
    div.innerHTML = `<b>${esc(killerName)}</b><span class="arrow">▸ ${esc(weaponName)} ▸</span><b>${esc(victimName)}</b>`;
    this.el.killfeed.appendChild(div);
    this.feed.push({ el: div, t: 5.0 });
    while (this.feed.length > 5) {
      const old = this.feed.shift();
      old.el.remove();
    }
  }

  // ------------------------------------------------------------- update ---

  update(dt, game) {
    const p = game.player;

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.el.flash.classList.remove('on');
    }
    // Arcs de direction : la classe part, la transition CSS fait le fondu.
    for (const d of this.dirs) {
      if (d.t <= 0) continue;
      d.t -= dt;
      if (d.t <= 0) d.el.classList.remove('on');
    }
    for (let i = this.feed.length - 1; i >= 0; i--) {
      this.feed[i].t -= dt;
      if (this.feed[i].t <= 0) { this.feed[i].el.remove(); this.feed.splice(i, 1); }
    }

    // Chrono et score
    this.el.time.textContent = game.duration > 0 ? formatTime(game.timeLeft) : '∞';
    this.el.kills.textContent = p.kills;
    this.el.deaths.textContent = p.deaths;
    const rank = game.rankOf(p);
    this.el.rank.innerHTML = rank === 1 ? '1<small>er</small>' : `${rank}<small>e</small>`;

    // Vitalité
    const hp = Math.max(0, Math.round(p.health));
    this.el.hpValue.textContent = hp;
    this.el.hpFill.style.width = hp + '%';
    this.el.hpFill.style.background = hp > 60 ? 'var(--ok)' : (hp > 25 ? 'var(--accent-2)' : 'var(--danger)');

    // Vignette de vie basse, avec hystérésis : elle s'allume à 30 et ne
    // s'éteint qu'à 35, sinon elle clignote dès qu'on encaisse à la frontière.
    const low = this._lowHp ? hp < LOW_HP_OFF : hp < LOW_HP_ON;
    if (low !== this._lowHp) {
      this._lowHp = low;
      this.el.lowhp.classList.toggle('on', low && p.alive);
    }
    if (this._lowHp && !p.alive) this.el.lowhp.classList.remove('on');

    // Arme et munitions
    const w = p.loadout.current;
    this.el.weaponName.textContent = w.def.name + ' · ' + w.def.role;
    this.el.ammoMag.textContent = w.isReloading ? '··' : w.ammo;
    this.el.ammoRes.textContent = w.reserve;
    this.el.ammoRow.classList.toggle('low', !w.isReloading && w.ammo <= w.def.mag * 0.25);
    this.el.reloadHint.classList.toggle('hidden', !(w.ammo === 0 && !w.isReloading));
    // Comparaison emplacement par emplacement, sans fabriquer de chaîne : ce
    // test tourne à chaque image et ne réécrit le DOM qu'une fois par partie.
    for (let i = 0; i < SLOT_COUNT; i++) {
      const id = p.loadout.slots[i].id;
      if (id !== this._slotIds[i]) {
        this._slotIds[i] = id;
        this.el.slots[i].textContent = `${i + 1} ${WEAPONS[id].name}`;
      }
    }
    if (p.loadout.index !== this._lastSlot) {
      this._lastSlot = p.loadout.index;
      this.el.slots.forEach((s, i) => s.classList.toggle('on', i === p.loadout.index));
    }

    // Réticule : s'ouvre au mouvement, se ferme en visée.
    const spread = p.speed2D > 3.2 && p.ads < 0.5;
    this.el.crosshair.classList.toggle('spread', spread);
    this.el.crosshair.classList.toggle('ads', p.ads > 0.6);

    // Écran de mort
    if (!p.alive) {
      this.el.respawn.classList.remove('hidden');
      this.el.respawnTimer.textContent = Math.max(0, Math.ceil(p.respawnTimer));
      this.el.respawnBy.textContent = p.lastDamageFrom ? `éliminé par ${p.lastDamageFrom.name}` : 'hors limites';
    } else {
      this.el.respawn.classList.add('hidden');
    }

    // Podium miniature
    const top = game.ranking().slice(0, 3);
    this.el.mini.innerHTML = top.map((a, i) =>
      `<span class="${a === p ? 'me' : ''}">${i + 1}. ${esc(a.name)} ${a.kills}</span>`).join('');

    // Images/s, moyennées sur une demi-seconde.
    this.fpsAccum += dt; this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fpsValue = Math.round(this.fpsFrames / this.fpsAccum);
      this.el.fps.textContent = this.fpsValue + ' FPS';
      this.fpsAccum = 0; this.fpsFrames = 0;
    }

    // Mini-carte : 15 Hz suffisent largement.
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0 && !this.el.minimap.classList.contains('hidden')) {
      this.minimapTimer = 1 / 15;
      this.drawMinimap(game);
    }
  }

  drawMinimap(game) {
    const c = this.ctx, W = this.el.minimap.width, H = this.el.minimap.height;
    const p = game.player;
    const range = 46;               // rayon affiché, en mètres
    const k = (W / 2) / range;

    c.clearRect(0, 0, W, H);
    c.save();
    c.translate(W / 2, H / 2);
    c.rotate(-(-p.viewYaw));        // le joueur regarde toujours vers le haut
    c.scale(k, k);
    c.translate(-p.pos.x, -p.pos.z);

    c.fillStyle = 'rgba(120,140,165,.32)';
    for (const r of game.world.minimapRects) {
      if (Math.abs(r.x - p.pos.x) > range + r.w || Math.abs(r.z - p.pos.z) > range + r.d) continue;
      c.fillRect(r.x - r.w / 2, r.z - r.d / 2, r.w, r.d);
    }

    for (const a of game.actors) {
      if (a === p || !a.alive) continue;
      const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
      if (dx * dx + dz * dz > range * range) continue;
      c.fillStyle = '#ff5d5d';
      c.beginPath(); c.arc(a.pos.x, a.pos.z, 1.9, 0, 6.283); c.fill();
    }
    c.restore();

    // Le joueur : un triangle fixe au centre.
    c.fillStyle = '#4fd1c5';
    c.beginPath();
    c.moveTo(W / 2, H / 2 - 7); c.lineTo(W / 2 - 5, H / 2 + 5); c.lineTo(W / 2 + 5, H / 2 + 5);
    c.closePath(); c.fill();
  }

  scoreboard(show, game) {
    this.el.scoreboard.classList.toggle('hidden', !show);
    if (show) this.el.sbBody.innerHTML = rankingRows(game);
  }
}

export function rankingRows(game) {
  return game.ranking().map((a, i) => {
    const ratio = a.deaths === 0 ? a.kills.toFixed(2) : (a.kills / a.deaths).toFixed(2);
    const color = '#' + (a.color || 0x888888).toString(16).padStart(6, '0');
    return `<tr class="${a === game.player ? 'me' : ''} ${i === 0 ? 'podium' : ''}">
      <td>${i + 1}</td>
      <td><span class="dot" style="background:${color}"></span>${esc(a.name)}</td>
      <td>${a.kills}</td><td>${a.deaths}</td><td>${ratio}</td></tr>`;
  }).join('');
}

/** Écart signé entre deux angles en degrés, ramené dans [-180, 180]. */
function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function formatTime(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
