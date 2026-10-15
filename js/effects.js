/**
 * effects.js — effets visuels, tous en pool de taille fixe.
 *
 * Deux objets de rendu au total (un LineSegments + un Points) : aucun objet
 * n'est créé ni détruit pendant la partie, donc pas de ramasse-miettes en
 * plein combat — c'est ce qui provoque les micro-saccades sur PC modeste.
 */

import * as THREE from '../vendor/three.module.js';
import { FLASH_SPOKES, FLASH_RADII, flashIndices } from './weapons.js';

const TRACERS = 48;
const SPARKS = 160;
const FLASHES = 16;                 // huit bots en rafale tiennent largement dedans
const FLASH_VERTS = FLASH_SPOKES + 1;

/**
 * Couleurs pré-converties. `new THREE.Color(hex)` applique la conversion
 * sRGB → linéaire de la gestion des couleurs r169 : on ne peut pas la remplacer
 * par un décalage de bits sans changer toutes les teintes. On la fait donc une
 * fois par teinte, et plus jamais — sinon c'est une allocation à chaque coup tiré.
 */
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
    for (let i = 0; i < FLASHES; i++) at = flashIndices(fIdx, i * FLASH_VERTS, at);
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
  }
}
