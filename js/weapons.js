/**
 * weapons.js — état des armes et modèles 3D "low-poly" faits à la main.
 *
 * Les armes sont des assemblages de boîtes : aucun fichier de modèle à charger,
 * une silhouette lisible, et un coût de rendu négligeable.
 */

import * as THREE from '../vendor/three.module.js';
import { WEAPONS, WEAPON_CATALOG, SLOT_COUNT, DEFAULT_SLOTS } from './config.js';

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

/**
 * Inventaire : SLOT_COUNT emplacements, chacun une arme avec ses munitions.
 *
 * Il ne contient PAS le catalogue. Il reçoit la liste de ce qu'il porte, et
 * ses objets Weapon sont alloués une fois pour toutes au constructeur :
 * `equip` les réarme en place, si bien qu'un bot qui change d'armes à chaque
 * réapparition ne crée jamais rien.
 */
export class Loadout {
  constructor(slots = DEFAULT_SLOTS, handId) {
    this.slots = [];
    for (let i = 0; i < SLOT_COUNT; i++) this.slots.push(new Weapon(DEFAULT_SLOTS[i]));
    this.index = 0;
    this.equip(slots, handId);
  }

  get current() { return this.slots[this.index]; }
  get currentId() { return this.slots[this.index].id; }

  /**
   * Arme l'inventaire avec `slots` (exactement SLOT_COUNT identifiants), munitions
   * pleines, `handId` en main — ou le premier emplacement s'il n'y figure pas.
   *
   * Un identifiant inconnu lève une erreur au lieu d'être ignoré : une faute de
   * frappe dans un trio doit casser au lancement de la partie, pas faire tirer
   * un acteur avec une définition `undefined`.
   */
  equip(slots, handId) {
    if (slots.length !== SLOT_COUNT) {
      throw new Error(`Inventaire de ${slots.length} armes, ${SLOT_COUNT} attendues`);
    }
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (!WEAPONS[slots[i]]) throw new Error(`Arme inconnue dans un inventaire : ${slots[i]}`);
      this.slots[i].set(slots[i]);
    }
    this.index = Math.max(0, slots.indexOf(handId));
  }

  /** Mêmes armes, même arme en main, munitions pleines : la réapparition du joueur. */
  reset() {
    for (const w of this.slots) w.set(w.id);
  }

  select(i) {
    if (i < 0 || i >= SLOT_COUNT || i === this.index) return false;
    this.index = i; return true;
  }
  cycle(dir) {
    this.index = (this.index + dir + SLOT_COUNT) % SLOT_COUNT;
    return true;
  }
  refillAll() { for (const w of this.slots) w.addMags(2); }
  update(dt) { for (const w of this.slots) w.update(dt); }
}

/** Tableau de travail de drawLoadout, réutilisé d'un tirage à l'autre. */
const _draw = [];

/**
 * Tire SLOT_COUNT armes DISTINCTES du catalogue — un mélange de Fisher-Yates
 * arrêté après SLOT_COUNT positions —, la première étant celle qu'on aura en
 * main. Avec un catalogue de trois armes elle est uniforme sur les trois, soit
 * exactement le tirage d'avant ; avec neuf, l'acteur en porte trois différentes.
 *
 * Le catalogue est un paramètre pour pouvoir éprouver ce tirage sur un
 * catalogue plus grand que celui du jeu. Le tableau rendu est RÉUTILISÉ : il se
 * consomme tout de suite, ce que fait `equip`, qui recopie les identifiants.
 */
export function drawLoadout(catalog = WEAPON_CATALOG) {
  if (catalog.length < SLOT_COUNT) {
    throw new Error(`Catalogue de ${catalog.length} armes, il en faut au moins ${SLOT_COUNT}`);
  }
  _draw.length = 0;
  for (let i = 0; i < catalog.length; i++) _draw.push(catalog[i]);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const j = i + Math.floor(Math.random() * (_draw.length - i));
    const t = _draw[i]; _draw[i] = _draw[j]; _draw[j] = t;
  }
  _draw.length = SLOT_COUNT;
  return _draw;
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

/**
 * Silhouette du flash de bouche : un éventail de triangles autour d'un sommet
 * central. Le centre porte la couleur, le pourtour est NOIR — en blending
 * additif le noir est transparent, donc on obtient un dégradé radial doux et
 * une silhouette en étoile sans le moindre octet de texture.
 *
 * Les rayons alternent long/court pour donner les branches. La même table sert
 * au modèle en vue subjective (ci-dessous) et au pool de effects.js, pour que
 * le flash d'un bot et celui du joueur soient la même forme.
 */
export const FLASH_SPOKES = 8;
export const FLASH_RADII = [1.0, 0.44, 0.82, 0.40, 1.0, 0.44, 0.82, 0.40];

/** Réduction du flash en vue subjective : deux caméras, deux distances. */
const VM_FLASH_SCALE = 0.30;

/**
 * Indices d'un éventail : sommet 0 au centre, 1..spokes au pourtour.
 *
 * Deux effets s'en servent, et pour des raisons opposées : le flash de bouche,
 * dont le centre est coloré et le pourtour noir en additif, et l'ombre de
 * contact (`effects.js`), dont le centre est sombre et le pourtour blanc en
 * multiplicatif. Dans les deux cas c'est le dégradé du sommet vers le pourtour
 * qui fait tout le travail, sans une seule texture.
 */
export function fanIndices(out, base, at, spokes = FLASH_SPOKES) {
  for (let s = 0; s < spokes; s++) {
    const a = base + 1 + s;
    const b = base + 1 + ((s + 1) % spokes);
    out[at++] = base; out[at++] = a; out[at++] = b;
  }
  return at;
}

/** Étoile de flash prête à l'emploi, dans le plan XY. */
function flashStar(color, size) {
  const n = FLASH_SPOKES;
  const pos = new Float32Array((n + 1) * 3);
  const col = new Float32Array((n + 1) * 3);
  const c = new THREE.Color(color);
  col[0] = c.r; col[1] = c.g; col[2] = c.b;          // centre : pleine couleur
  for (let s = 0; s < n; s++) {
    const a = (s / n) * Math.PI * 2;
    const r = FLASH_RADII[s] * size;
    const o = (s + 1) * 3;
    pos[o] = Math.cos(a) * r; pos[o + 1] = Math.sin(a) * r; pos[o + 2] = 0;
    // pourtour laissé à zéro : c'est ce qui fait le dégradé.
  }
  const idx = new Uint16Array(n * 3);
  fanIndices(idx, 0, 0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
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

  // Flash de bouche, à la pointe du canon (boîte de 0,5 centrée en
  // -body[2] - 0.18, donc pointe en -(body[2] + 0.43)). Enfant de l'arme : il
  // hérite gratuitement du recul, du balancement de marche et de la visée.
  //
  // `muzzle.size` est un rayon en mètres, calibré pour le flash vu de loin dans
  // le monde. Ici la scène est rendue par la caméra d'arme, à moins de deux
  // unités : à taille égale l'étoile mangerait la moitié de l'écran.
  //
  // Le canon s'arrête en -(body[2] + 0.43) : l'étoile se place JUSTE DEVANT.
  // Deux centimètres derrière et l'embout du canon masque son cœur lumineux —
  // ce qui ne se voit pas sur le large flash du Broyeur, mais escamote
  // complètement celui de la Rafale.
  const flash = flashStar(def.muzzle.color, def.muzzle.size * VM_FLASH_SCALE);
  flash.position.set(0, 0.02, -(def.body[2] + 0.41));
  flash.visible = false;
  g.add(flash);
  g.userData.flash = flash;
  return g;
}

/**
 * Petite arme portée par les bots, vue de l'extérieur — décrite en boîtes et
 * non en `Mesh` : bots.js la fusionne dans la géométrie du bras. Les formes
 * d'armes restent décrites ici, avec celles de la vue subjective.
 *
 * Repère de l'arme : le canon part vers -Z, l'origine est le point de montage.
 */
export function botWeaponBoxes(color) {
  return [
    { w: 0.09, h: 0.10, d: 0.55, x: 0, y: 0, z: -0.20, color: 0x2b3038 },
    { w: 0.06, h: 0.06, d: 0.14, x: 0, y: 0.06, z: -0.05, color },
  ];
}

