/**
 * effects.js — effets visuels, tous en pool de taille fixe.
 *
 * Quatre objets de rendu au total (un LineSegments, un Points et deux Mesh) :
 * aucun objet n'est créé ni détruit pendant la partie, donc pas de
 * ramasse-miettes en plein combat — c'est ce qui provoque les micro-saccades
 * sur PC modeste.
 */

import * as THREE from '../vendor/three.module.js';
import { FLASH_SPOKES, FLASH_RADII, flashIndices } from './weapons.js';

const TRACERS = 48;
const SPARKS = 160;
const FLASHES = 16;                 // huit bots en rafale tiennent largement dedans
const FLASH_VERTS = FLASH_SPOKES + 1;

/**
 * Ombres de contact : un disque par acteur vivant.
 *
 * 12 emplacements = un joueur + onze bots, le maximum du curseur de `index.html`.
 * Au-delà, `addShadow` laisse tomber les disques en trop plutôt que d'écrire
 * hors du tampon : un bot sans ombre reste préférable à une exception.
 *
 * Le disque est un éventail bordé d'un anneau de quads, et non un simple carré :
 * un quad n'a que quatre sommets, tous sur son pourtour, donc aucun endroit où
 * poser le sombre. Il sortirait en aplat — un autocollant, pas une ombre. Avec
 * un centre, un anneau sombre et un pourtour clair, le dégradé est porté par
 * les sommets, comme pour le flash de bouche. 24 triangles par acteur, soit
 * 288 au plus sur la carte entière : négligeable devant les 8,7k à 56k du décor.
 */
const SHADOWS = 12;
const SHADOW_SPOKES = 8;
const SHADOW_VERTS = 1 + SHADOW_SPOKES * 2;      // centre + anneau sombre + pourtour
const SHADOW_INDICES = SHADOW_SPOKES * 3 * 3;    // 1 triangle d'éventail + 2 d'anneau par rayon
const SHADOW_CORE = 0.45;                        // rayon de l'anneau sombre, en fraction du total

// Cercle unité pré-calculé : le disque est toujours horizontal et jamais tourné,
// donc ces huit directions servent telles quelles à chaque image.
const SHADOW_COS = new Float32Array(SHADOW_SPOKES);
const SHADOW_SIN = new Float32Array(SHADOW_SPOKES);
for (let s = 0; s < SHADOW_SPOKES; s++) {
  const a = (s / SHADOW_SPOKES) * Math.PI * 2;
  SHADOW_COS[s] = Math.cos(a);
  SHADOW_SIN[s] = Math.sin(a);
}

/**
 * Couleurs pré-converties. `new THREE.Color(hex)` applique la conversion
 * sRGB → linéaire de la gestion des couleurs r169 : on ne peut pas la remplacer
 * par un décalage de bits sans changer toutes les teintes. On la fait donc une
 * fois par teinte, et plus jamais — sinon c'est une allocation à chaque coup tiré.
 */
/**
 * sRGB → linéaire, pour un canal seul.
 *
 * Indispensable aux ombres de contact, et c'est le piège le plus coûteux de
 * tout le fichier parce qu'il est MUET. Le shader écrit la couleur de sommet
 * telle quelle, puis `colorspace_fragment` l'encode en sRGB — et ça, contrairement
 * à ce qu'on croit en lisant le matériau, `toneMapped: false` ne le désactive
 * PAS : les deux étapes sont distinctes. Un facteur 0,50 posé en linéaire arrive
 * donc à 0,735 dans le tampon, soit 26 % d'assombrissement au lieu de 50. On
 * écrit donc l'antécédent, pour que l'encodage de sortie rende le facteur voulu.
 *
 * Pas de `THREE.Color` ici : il en faudrait une instance par appel, soit une
 * allocation par acteur et par image, ce que ce fichier existe pour éviter.
 */
function versLineaire(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

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

    // --- ombres de contact ---
    // Même procédé que le flash de bouche, exactement à l'envers. En additif, le
    // noir ne dessine rien et le dégradé va du centre coloré vers un pourtour
    // noir ; en MULTIPLY, c'est le BLANC qui ne dessine rien, donc le centre est
    // sombre et le pourtour blanc. Dans les deux cas le dégradé est dans les
    // sommets : aucune texture, et un seul draw call pour tous les acteurs.
    //
    // Multiply est l'opérateur juste pour une ombre, et pas seulement le plus
    // simple : il retire une fraction de la lumière au lieu d'ajouter du noir,
    // donc le sol garde sa teinte et un sol déjà sombre ne devient pas une
    // tache. C'est aussi, au signe près, ce que fait l'occlusion ambiante cuite
    // dans le décor, qui multiplie elle aussi une couleur de sommet.
    const gg = new THREE.BufferGeometry();
    this.gPos = new Float32Array(SHADOWS * SHADOW_VERTS * 3);
    this.gCol = new Float32Array(SHADOWS * SHADOW_VERTS * 3);
    const gIdx = new Uint16Array(SHADOWS * SHADOW_INDICES);
    let gat = 0;
    for (let i = 0; i < SHADOWS; i++) {
      const base = i * SHADOW_VERTS;
      const inner = base + 1, outer = base + 1 + SHADOW_SPOKES;
      // L'ordre des sommets donne à chaque triangle une normale vers le HAUT,
      // et c'est tout sauf un détail : inversé, la normale regarde le sol, le
      // disque part en face arrière et n'apparaît JAMAIS — un maillage qui
      // coûte son draw call sans dessiner un pixel. Le piège est muet : rien
      // n'avertit, et le compte de draw calls, lui, est correct. C'est une
      // différence de pixels, allumé puis éteint, qui le révèle.
      for (let s = 0; s < SHADOW_SPOKES; s++) {
        const n = (s + 1) % SHADOW_SPOKES;
        gIdx[gat++] = base;      gIdx[gat++] = inner + n; gIdx[gat++] = inner + s;
        gIdx[gat++] = inner + s; gIdx[gat++] = outer + n; gIdx[gat++] = outer + s;
        gIdx[gat++] = inner + s; gIdx[gat++] = inner + n; gIdx[gat++] = outer + n;
      }
      // Le pourtour est blanc une fois pour toutes : en multiply il est
      // invisible, et c'est lui qui éteint le dégradé sur le sol intact.
      for (let s = 0; s < SHADOW_SPOKES; s++) {
        const o = (outer + s) * 3;
        this.gCol[o] = 1; this.gCol[o + 1] = 1; this.gCol[o + 2] = 1;
      }
    }
    gg.setAttribute('position', new THREE.BufferAttribute(this.gPos, 3));
    gg.setAttribute('color', new THREE.BufferAttribute(this.gCol, 3));
    gg.setIndex(new THREE.BufferAttribute(gIdx, 1));
    gg.setDrawRange(0, 0);
    this.shadowMesh = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({
      vertexColors: true,
      blending: THREE.MultiplyBlending,
      // `transparent` ne sert pas à l'opacité ici, il sert à l'ORDRE : il place
      // le disque dans la passe transparente, donc après tout l'opaque. Un
      // multiply a besoin que le sol soit déjà dans le tampon pour l'assombrir.
      transparent: true,
      depthWrite: false,         // les disques ne se masquent pas entre eux
      toneMapped: false,         // sinon la courbe ACES tord le facteur : 0,5 n'assombrit plus de moitié
      fog: false,                // le brouillard remplacerait le facteur par sa propre teinte, qui éclaircirait
    }));
    this.shadowMesh.frustumCulled = false;
    scene.add(this.shadowMesh);
    this._shadow = 0;
  }

  // ------------------------------------------------------ ombres de contact ---

  /** Ouvre la passe : les disques sont réécrits du premier au dernier. */
  beginShadows() { this._shadow = 0; }

  /**
   * Un disque posé à plat, centré en (x, z) à la hauteur y.
   *
   * `strength` est l'assombrissement au centre : 0 ne touche à rien, 1 est noir.
   * On le convertit en facteur multiplicatif, parce que c'est ce que lit le
   * mélange — et dans ce repère c'est 1 qui est transparent, pas 0.
   */
  addShadow(x, y, z, radius, strength) {
    if (this._shadow >= SHADOWS) return;
    const i = this._shadow++;
    const base = i * SHADOW_VERTS;
    // `strength` est l'assombrissement VOULU À L'ÉCRAN ; `k` est ce qu'il faut
    // écrire en linéaire pour l'obtenir après encodage sRGB (voir versLineaire).
    const k = versLineaire(1 - Math.max(0, Math.min(1, strength)));

    let o = base * 3;
    this.gPos[o] = x; this.gPos[o + 1] = y; this.gPos[o + 2] = z;
    this.gCol[o] = k; this.gCol[o + 1] = k; this.gCol[o + 2] = k;

    const rc = radius * SHADOW_CORE;
    for (let s = 0; s < SHADOW_SPOKES; s++) {
      const cs = SHADOW_COS[s], sn = SHADOW_SIN[s];
      o = (base + 1 + s) * 3;                          // anneau sombre
      this.gPos[o] = x + cs * rc; this.gPos[o + 1] = y; this.gPos[o + 2] = z + sn * rc;
      this.gCol[o] = k; this.gCol[o + 1] = k; this.gCol[o + 2] = k;
      o = (base + 1 + SHADOW_SPOKES + s) * 3;          // pourtour, déjà blanc
      this.gPos[o] = x + cs * radius; this.gPos[o + 1] = y; this.gPos[o + 2] = z + sn * radius;
    }
  }

  /**
   * Ferme la passe. Les disques vivants sont compactés au début du tampon, donc
   * une simple plage de dessin suffit à éteindre les autres : contrairement aux
   * flashs, il n'y a rien à repeindre en couleur neutre.
   */
  endShadows() {
    const g = this.shadowMesh.geometry;
    g.setDrawRange(0, this._shadow * SHADOW_INDICES);
    // Une plage de dessin nulle coûte quand même son draw call — mesuré : three.js
    // n'écarte pas l'objet pour autant. `visible` le fait, lui.
    this.shadowMesh.visible = this._shadow > 0;
    if (this._shadow > 0) {
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    }
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
