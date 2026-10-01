/**
 * effects.js — effets visuels, tous en pool de taille fixe.
 *
 * Deux objets de rendu au total (un LineSegments + un Points) : aucun objet
 * n'est créé ni détruit pendant la partie, donc pas de ramasse-miettes en
 * plein combat — c'est ce qui provoque les micro-saccades sur PC modeste.
 */

import * as THREE from '../vendor/three.module.js';
import { FLASH_SPOKES, FLASH_RADII, fanIndices } from './weapons.js';

const TRACERS = 48;
const SPARKS = 160;
const FLASHES = 16;                 // huit bots en rafale tiennent largement dedans
const FLASH_VERTS = FLASH_SPOKES + 1;

// --- ombres de contact ---
const SHADOWS = 16;                 // onze bots + le joueur, avec de la marge
const SHADOW_SPOKES = 10;           // un disque, pas l'étoile du flash
/**
 * Deux anneaux et pas un seul. Avec un éventail simple, seul le sommet central
 * porte la teinte sombre et tout le reste s'éclaircit linéairement : mesuré,
 * ça ne retirait que 35 niveaux sur 255 au plus noir, une tache à peine
 * visible. L'anneau intérieur, sombre lui aussi, donne un noyau plein ; la
 * couronne jusqu'au bord fait l'adoucissement.
 */
const SHADOW_INNER = 0.60;          // rayon du noyau, en fraction du rayon total
const SHADOW_VERTS = 1 + SHADOW_SPOKES * 2;
const SHADOW_TRIS = SHADOW_SPOKES * 3;

/**
 * Couleurs pré-converties. `new THREE.Color(hex)` applique la conversion
 * sRGB → linéaire de la gestion des couleurs r169 : on ne peut pas la remplacer
 * par un décalage de bits sans changer toutes les teintes. On la fait donc une
 * fois par teinte, et plus jamais — sinon c'est une allocation à chaque coup tiré.
 */
/**
 * Ce qui reste de la lumière du sol sous le noyau d'une ombre à pleine
 * intensité — en LINÉAIRE. Le shader encode sa sortie en sRGB avant le
 * mélange, donc 0,22 devient environ 0,50 à l'écran : le sol perd la moitié de
 * sa lumière, pas les quatre cinquièmes. Se tromper de repère ici donne une
 * ombre qu'on croit posée et qu'on ne voit pas (mesuré : 0,42 linéaire ne
 * retirait que 48 niveaux sur 255).
 */
const SHADOW_DARK = 0.18;

const COLORS = new Map();
const _work = new THREE.Color();
function rgbOf(hex) {
  let c = COLORS.get(hex);
  if (!c) { _work.setHex(hex); c = { r: _work.r, g: _work.g, b: _work.b }; COLORS.set(hex, c); }
  return c;
}

export class Effects {
  constructor(scene, quality) {
    this.scale = quality.particles;

    // --- traçantes ---
    const tg = new THREE.BufferGeometry();
    this.tPos = new Float32Array(TRACERS * 6);
    this.tCol = new Float32Array(TRACERS * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3));
    tg.setDrawRange(0, 0);
    this.tracerMesh = new THREE.LineSegments(
      tg,
      new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,   // une traçante émet de la lumière
      })
    );
    this.tracerMesh.frustumCulled = false;
    scene.add(this.tracerMesh);
    this.tracers = [];
    for (let i = 0; i < TRACERS; i++) this.tracers.push({ life: 0, max: 0.09, r: 1, g: 1, b: 1 });

    // --- étincelles d'impact ---
    const sg = new THREE.BufferGeometry();
    this.sPos = new Float32Array(SPARKS * 3);
    this.sCol = new Float32Array(SPARKS * 3);
    for (let i = 0; i < SPARKS; i++) this.sPos[i * 3 + 1] = -1000;
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3));
    this.sparkMesh = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        size: 0.075, vertexColors: true, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    this.sparkMesh.frustumCulled = false;
    scene.add(this.sparkMesh);
    this.sparks = [];
    for (let i = 0; i < SPARKS; i++) this.sparks.push({ life: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 });
    this._spark = 0;
    this._tracer = 0;

    // --- flashs de bouche (ceux des bots ; le joueur a le sien sur son arme) ---
    // Même silhouette que le flash en vue subjective : un éventail dont le
    // centre porte la couleur et le pourtour reste noir.
    const fg = new THREE.BufferGeometry();
    this.fPos = new Float32Array(FLASHES * FLASH_VERTS * 3);
    this.fCol = new Float32Array(FLASHES * FLASH_VERTS * 3);
    const fIdx = new Uint16Array(FLASHES * FLASH_SPOKES * 3);
    let at = 0;
    for (let i = 0; i < FLASHES; i++) at = fanIndices(fIdx, i * FLASH_VERTS, at);
    fg.setAttribute('position', new THREE.BufferAttribute(this.fPos, 3));
    fg.setAttribute('color', new THREE.BufferAttribute(this.fCol, 3));
    fg.setIndex(new THREE.BufferAttribute(fIdx, 1));
    this.flashMesh = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.flashMesh.frustumCulled = false;
    scene.add(this.flashMesh);
    this.flashes = [];
    for (let i = 0; i < FLASHES; i++) this.flashes.push({ life: 0, max: 1, r: 1, g: 1, b: 1 });
    this._flash = 0;

    // --- ombres de contact ---
    // Le même éventail que le flash, retourné dans son principe : le centre est
    // SOMBRE, le pourtour BLANC, et le mélange est MULTIPLICATIF — en multiply
    // le blanc est l'élément neutre, donc le pourtour ne dessine rien et le
    // dégradé du centre vers le bord est l'adoucissement de l'ombre. Un disque
    // net aurait un bord franc ; une texture coûterait un fichier que le projet
    // s'interdit.
    const shg = new THREE.BufferGeometry();
    this.shPos = new Float32Array(SHADOWS * SHADOW_VERTS * 3);
    this.shCol = new Float32Array(SHADOWS * SHADOW_VERTS * 3);
    const shIdx = new Uint16Array(SHADOWS * SHADOW_TRIS * 3);
    let shAt = 0;
    for (let i = 0; i < SHADOWS; i++) {
      const base = i * SHADOW_VERTS;
      shAt = fanIndices(shIdx, base, shAt, SHADOW_SPOKES);     // noyau : centre + anneau intérieur
      for (let k = 0; k < SHADOW_SPOKES; k++) {                // couronne : intérieur → bord
        const i0 = base + 1 + k, i1 = base + 1 + ((k + 1) % SHADOW_SPOKES);
        const o0 = base + 1 + SHADOW_SPOKES + k;
        const o1 = base + 1 + SHADOW_SPOKES + ((k + 1) % SHADOW_SPOKES);
        shIdx[shAt++] = i0; shIdx[shAt++] = o0; shIdx[shAt++] = o1;
        shIdx[shAt++] = i0; shIdx[shAt++] = o1; shIdx[shAt++] = i1;
      }
    }
    for (let i = 0; i < this.shCol.length; i++) this.shCol[i] = 1;   // tout éteint = tout blanc
    shg.setAttribute('position', new THREE.BufferAttribute(this.shPos, 3));
    shg.setAttribute('color', new THREE.BufferAttribute(this.shCol, 3));
    shg.setIndex(new THREE.BufferAttribute(shIdx, 1));
    this.shadowMesh = new THREE.Mesh(shg, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.MultiplyBlending,
      // Sans ça, la courbe ACES de _setupRenderer s'applique AUSSI au blanc du
      // pourtour : il cesse d'être neutre et cerne l'ombre d'un disque plus
      // sombre que le sol. C'est la condition de tout le procédé.
      toneMapped: false,
    }));
    this.shadowMesh.frustumCulled = false;
    scene.add(this.shadowMesh);
    // Le pourtour tourne dans le sens NÉGATIF en Z. Avec (cos a, 0, sin a), la
    // normale des triangles vaut (0, -sin(Δa), 0) : le disque regarde vers le
    // bas et disparaît, éliminé en face arrière. Le sinus opposé le retourne —
    // et une ombre au sol ne se regarde que du dessus, donc `FrontSide` suffit.
    this._shadowCos = new Float32Array(SHADOW_SPOKES);
    this._shadowSin = new Float32Array(SHADOW_SPOKES);
    for (let s = 0; s < SHADOW_SPOKES; s++) {
      const a = (s / SHADOW_SPOKES) * Math.PI * 2;
      this._shadowCos[s] = Math.cos(a); this._shadowSin[s] = -Math.sin(a);
    }
    this._shadowsUsed = 0;
  }

  /**
   * Pose l'ombre `i` : un disque horizontal centré en (x,y,z), de rayon
   * `radius`, d'intensité `strength` (0 = invisible, 1 = aussi sombre que
   * SHADOW_DARK le permet).
   *
   * Appelée à chaque image pour chaque acteur vivant, donc sans une seule
   * allocation : on réécrit les mêmes tableaux. Le drapeau de mise à jour des
   * tampons est posé une seule fois, par `hideShadowsFrom` en fin de boucle.
   */
  setShadow(i, x, y, z, radius, strength) {
    if (i >= SHADOWS) return;
    const base = i * SHADOW_VERTS;
    const k = Math.max(0, Math.min(1, strength));
    // Du blanc (neutre) vers SHADOW_DARK selon l'intensité.
    const c = 1 - (1 - SHADOW_DARK) * k;
    const inner = radius * SHADOW_INNER;
    let o = base * 3;
    this.shPos[o] = x; this.shPos[o + 1] = y; this.shPos[o + 2] = z;
    this.shCol[o] = c; this.shCol[o + 1] = c; this.shCol[o + 2] = c;
    for (let s = 0; s < SHADOW_SPOKES; s++) {
      const cs = this._shadowCos[s], sn = this._shadowSin[s];
      o = (base + 1 + s) * 3;                                   // anneau intérieur : sombre
      this.shPos[o] = x + cs * inner;
      this.shPos[o + 1] = y;
      this.shPos[o + 2] = z + sn * inner;
      this.shCol[o] = c; this.shCol[o + 1] = c; this.shCol[o + 2] = c;
      o = (base + 1 + SHADOW_SPOKES + s) * 3;                   // bord : blanc, donc neutre
      this.shPos[o] = x + cs * radius;
      this.shPos[o + 1] = y;
      this.shPos[o + 2] = z + sn * radius;
      this.shCol[o] = 1; this.shCol[o + 1] = 1; this.shCol[o + 2] = 1;
    }
    if (i >= this._shadowsUsed) this._shadowsUsed = i + 1;
  }

  /**
   * Éteint les ombres à partir de `count` : acteurs morts, bots pas encore
   * réapparus, fin de partie. Éteindre, c'est repasser au blanc — le neutre du
   * multiplicatif — comme un flash éteint repasse au noir en additif.
   */
  hideShadowsFrom(count) {
    for (let i = count; i < this._shadowsUsed; i++) {
      const base = i * SHADOW_VERTS;
      for (let v = 0; v < SHADOW_VERTS; v++) {
        const o = (base + v) * 3;
        this.shCol[o] = 1; this.shCol[o + 1] = 1; this.shCol[o + 2] = 1;
      }
    }
    this._shadowsUsed = Math.min(count, SHADOWS);   // borne : douze acteurs, pool de seize
    this.shadowMesh.geometry.attributes.position.needsUpdate = true;
    this.shadowMesh.geometry.attributes.color.needsUpdate = true;
  }

  addTracer(x0, y0, z0, x1, y1, z1, color = 0xfff0b0) {
    const i = this._tracer; this._tracer = (this._tracer + 1) % TRACERS;
    const t = this.tracers[i];
    t.life = t.max;
    const c = rgbOf(color);
    t.r = c.r; t.g = c.g; t.b = c.b;
    const o = i * 6;
    this.tPos[o] = x0; this.tPos[o + 1] = y0; this.tPos[o + 2] = z0;
    this.tPos[o + 3] = x1; this.tPos[o + 4] = y1; this.tPos[o + 5] = z1;
  }

  addImpact(x, y, z, nx, ny, nz, color = 0xffd9a0, count = 6) {
    const n = Math.max(1, Math.round(count * this.scale));
    const c = rgbOf(color);
    for (let k = 0; k < n; k++) {
      const i = this._spark; this._spark = (this._spark + 1) % SPARKS;
      const s = this.sparks[i];
      s.life = 0.28 + Math.random() * 0.22;
      const spread = 2.6;
      s.vx = nx * 2 + (Math.random() - 0.5) * spread;
      s.vy = ny * 2 + Math.random() * spread;
      s.vz = nz * 2 + (Math.random() - 0.5) * spread;
      s.r = c.r; s.g = c.g; s.b = c.b;
      const o = i * 3;
      this.sPos[o] = x; this.sPos[o + 1] = y; this.sPos[o + 2] = z;
    }
  }

  /**
   * Flash de bouche dans le monde, orienté face à la caméra.
   *
   * L'orientation est figée à l'allumage : sur 45 à 75 ms la caméra n'a pas le
   * temps de bouger assez pour que ça se voie, et ça évite de réécrire les
   * positions à chaque image.
   */
  addMuzzle(x, y, z, camX, camY, camZ, muzzle) {
    const i = this._flash; this._flash = (this._flash + 1) % FLASHES;
    const f = this.flashes[i];
    f.life = f.max = muzzle.life;
    const c = rgbOf(muzzle.color);
    f.r = c.r; f.g = c.g; f.b = c.b;

    // Repère du disque : normale vers la caméra, plus deux axes du plan.
    let nx = camX - x, ny = camY - y, nz = camZ - z;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    // "haut" de secours si on regarde le flash à la verticale.
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(ny) > 0.98) { ux = 1; uy = 0; }
    let ax = uy * nz - uz * ny, ay = uz * nx - ux * nz, az = ux * ny - uy * nx;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;

    // Roulis au hasard : deux coups d'affilée ne se superposent pas.
    const roll = Math.random() * Math.PI * 2;
    const base = i * FLASH_VERTS;
    let o = base * 3;
    this.fPos[o] = x; this.fPos[o + 1] = y; this.fPos[o + 2] = z;
    // Couleur du centre posée tout de suite : le flash ne dépend pas de l'ordre
    // d'appel entre le tir et update().
    this.fCol[o] = f.r; this.fCol[o + 1] = f.g; this.fCol[o + 2] = f.b;
    this.flashMesh.geometry.attributes.color.needsUpdate = true;
    for (let s = 0; s < FLASH_SPOKES; s++) {
      const a = roll + (s / FLASH_SPOKES) * Math.PI * 2;
      const r = FLASH_RADII[s] * muzzle.size;
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      o = (base + 1 + s) * 3;
      this.fPos[o] = x + ax * ca + bx * sa;
      this.fPos[o + 1] = y + ay * ca + by * sa;
      this.fPos[o + 2] = z + az * ca + bz * sa;
    }
    this.flashMesh.geometry.attributes.position.needsUpdate = true;
  }

  update(dt) {
    // Traçantes : on compacte les segments vivants au début du buffer.
    let drawn = 0;
    for (let i = 0; i < TRACERS; i++) {
      const t = this.tracers[i];
      if (t.life <= 0) continue;
      t.life -= dt;
      const a = Math.max(0, t.life / t.max);
      const o = i * 6;
      for (let v = 0; v < 2; v++) {
        this.tCol[o + v * 3] = t.r * a;
        this.tCol[o + v * 3 + 1] = t.g * a;
        this.tCol[o + v * 3 + 2] = t.b * a;
      }
      drawn = Math.max(drawn, (i + 1) * 2);
    }
    this.tracerMesh.geometry.setDrawRange(0, drawn);
    this.tracerMesh.geometry.attributes.position.needsUpdate = true;
    this.tracerMesh.geometry.attributes.color.needsUpdate = true;

    // Étincelles : gravité simple, pas de collision.
    for (let i = 0; i < SPARKS; i++) {
      const s = this.sparks[i];
      const o = i * 3;
      if (s.life <= 0) { this.sCol[o] = 0; this.sCol[o + 1] = 0; this.sCol[o + 2] = 0; continue; }
      s.life -= dt;
      s.vy -= 13 * dt;
      this.sPos[o] += s.vx * dt;
      this.sPos[o + 1] += s.vy * dt;
      this.sPos[o + 2] += s.vz * dt;
      const a = Math.max(0, Math.min(1, s.life * 3));
      this.sCol[o] = s.r * a; this.sCol[o + 1] = s.g * a; this.sCol[o + 2] = s.b * a;
      if (s.life <= 0) this.sPos[o + 1] = -1000;
    }
    this.sparkMesh.geometry.attributes.position.needsUpdate = true;
    this.sparkMesh.geometry.attributes.color.needsUpdate = true;

    // Flashs : on ne déplace rien, on éteint la couleur. En additif, du noir
    // ne dessine rien — c'est déjà la façon dont les étincelles disparaissent.
    for (let i = 0; i < FLASHES; i++) {
      const f = this.flashes[i];
      const base = i * FLASH_VERTS;
      if (f.life <= 0) {
        if (f.max > 0) {                       // éteindre une seule fois
          for (let v = 0; v < FLASH_VERTS; v++) {
            const o = (base + v) * 3;
            this.fCol[o] = 0; this.fCol[o + 1] = 0; this.fCol[o + 2] = 0;
          }
          f.max = 0;
          this.flashMesh.geometry.attributes.color.needsUpdate = true;
        }
        continue;
      }
      f.life -= dt;
      const a = Math.max(0, f.life / f.max);
      const o = base * 3;
      this.fCol[o] = f.r * a; this.fCol[o + 1] = f.g * a; this.fCol[o + 2] = f.b * a;
      this.flashMesh.geometry.attributes.color.needsUpdate = true;
    }
  }

  dispose() {
    this.tracerMesh.geometry.dispose(); this.tracerMesh.material.dispose();
    this.sparkMesh.geometry.dispose(); this.sparkMesh.material.dispose();
    // Retiré de la scène avant d'être libéré : game.dispose() parcourt ensuite
    // les scènes pour libérer ce qui reste, et ne doit pas retomber dessus.
    if (this.flashMesh.parent) this.flashMesh.parent.remove(this.flashMesh);
    this.flashMesh.geometry.dispose(); this.flashMesh.material.dispose();
    if (this.shadowMesh.parent) this.shadowMesh.parent.remove(this.shadowMesh);
    this.shadowMesh.geometry.dispose(); this.shadowMesh.material.dispose();
  }
}
