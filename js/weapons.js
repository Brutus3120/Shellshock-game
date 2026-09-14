/**
 * weapons.js — état des armes et modèles 3D "low-poly" faits à la main.
 *
 * Les armes sont des assemblages de boîtes : aucun fichier de modèle à charger,
 * une silhouette lisible, et un coût de rendu négligeable.
 */

import * as THREE from '../vendor/three.module.js';
import { WEAPONS, WEAPON_ORDER } from './config.js';

export class Weapon {
  constructor(id) {
    this.set(id);
  }

  set(id) {
    this.def = WEAPONS[id];
    this.id = id;
    this.ammo = this.def.mag;
    this.reserve = this.def.reserve;
    this.cooldown = 0;
    this.reloading = 0;
    this.triggerHeld = false;
    this.shotsFired = 0;
  }

  get interval() { return 60 / this.def.rpm; }
  get isReloading() { return this.reloading > 0; }
  get isEmpty() { return this.ammo <= 0; }
  get canReload() { return this.ammo < this.def.mag && this.reserve > 0 && !this.isReloading; }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = this.def.mag - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
    }
  }

  /** Vrai si le coup part réellement (gère cadence, chargeur, rechargement). */
  tryFire(held) {
    if (this.reloading > 0 || this.cooldown > 0) return false;
    if (!this.def.auto && held) return false;     // semi-auto : un clic = un coup
    if (this.ammo <= 0) return false;
    this.ammo--;
    this.cooldown = this.interval;
    this.shotsFired++;
    return true;
  }

  startReload() {
    if (!this.canReload) return false;
    this.reloading = this.def.reloadTime;
    return true;
  }

  addMags(n) {
    const before = this.reserve;
    this.reserve = Math.min(this.def.reserve, this.reserve + this.def.mag * n);
    return this.reserve > before;
  }
}

/** Inventaire : les trois armes, avec leurs munitions propres. */
export class Loadout {
  constructor(startId = 'rafale') {
    this.weapons = {};
    for (const id of WEAPON_ORDER) this.weapons[id] = new Weapon(id);
    this.index = WEAPON_ORDER.indexOf(startId);
    if (this.index < 0) this.index = 0;
  }
  get current() { return this.weapons[WEAPON_ORDER[this.index]]; }
  get currentId() { return WEAPON_ORDER[this.index]; }
  select(i) {
    if (i < 0 || i >= WEAPON_ORDER.length || i === this.index) return false;
    this.index = i; return true;
  }
  cycle(dir) {
    this.index = (this.index + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length;
    return true;
  }
  refillAll() { for (const id of WEAPON_ORDER) this.weapons[id].addMags(2); }
  reset(startId) {
    for (const id of WEAPON_ORDER) this.weapons[id].set(id);
    this.index = Math.max(0, WEAPON_ORDER.indexOf(startId));
  }
  update(dt) { for (const id of WEAPON_ORDER) this.weapons[id].update(dt); }
}

// ------------------------------------------------------------- modèles 3D ---

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color })
  );
  m.position.set(x, y, z);
  return m;
}

/** Arme vue à la première personne. Rendue par une caméra dédiée (voir game.js). */
export function createViewModel(id) {
  const def = WEAPONS[id];
  const g = new THREE.Group();
  const dark = 0x353b45, mid = 0x4d5664;

  g.add(box(def.body[0], def.body[1], def.body[2], mid, 0, 0, -def.body[2] / 2));
  g.add(box(0.055, 0.055, 0.5, dark, 0, 0.02, -def.body[2] - 0.18));      // canon
  g.add(box(0.07, 0.2, 0.12, dark, 0, -0.14, -0.06));                      // poignée
  g.add(box(0.08, 0.16, 0.1, def.color, 0, -0.12, -def.body[2] * 0.55));   // chargeur

  if (id === 'lynx') {
    g.add(box(0.05, 0.07, 0.3, dark, 0, 0.11, -0.35));                     // lunette
    g.add(box(0.09, 0.09, 0.09, 0x14181d, 0, 0.11, -0.2));
  } else if (id === 'broyeur') {
    g.add(box(0.05, 0.05, 0.36, dark, 0, -0.06, -0.62));                   // pompe
  } else {
    g.add(box(0.04, 0.06, 0.16, dark, 0, 0.09, -0.5));                     // poignée de transport
  }
  const led = box(0.03, 0.03, 0.03, def.color, 0.055, 0.06, -0.16);
  led.material.emissive = new THREE.Color(def.color);
  led.material.emissiveIntensity = 1;
  g.add(led);
  return g;
}

/** Petite arme portée par les bots, vue de l'extérieur. */
export function createBotWeaponMesh(color) {
  const g = new THREE.Group();
  g.add(box(0.09, 0.1, 0.55, 0x2b3038, 0, 0, -0.2));
  g.add(box(0.06, 0.06, 0.14, color, 0, 0.06, -0.05));
  return g;
}

export { WEAPON_ORDER };
