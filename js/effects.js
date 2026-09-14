/**
 * effects.js — effets visuels, tous en pool de taille fixe.
 *
 * Deux objets de rendu au total (un LineSegments + un Points) : aucun objet
 * n'est créé ni détruit pendant la partie, donc pas de ramasse-miettes en
 * plein combat — c'est ce qui provoque les micro-saccades sur PC modeste.
 */

import * as THREE from '../vendor/three.module.js';

const TRACERS = 48;
const SPARKS = 160;

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
  }

  addTracer(x0, y0, z0, x1, y1, z1, color = 0xfff0b0) {
    const i = this._tracer; this._tracer = (this._tracer + 1) % TRACERS;
    const t = this.tracers[i];
    t.life = t.max;
    const c = new THREE.Color(color);
    t.r = c.r; t.g = c.g; t.b = c.b;
    const o = i * 6;
    this.tPos[o] = x0; this.tPos[o + 1] = y0; this.tPos[o + 2] = z0;
    this.tPos[o + 3] = x1; this.tPos[o + 4] = y1; this.tPos[o + 5] = z1;
  }

  addImpact(x, y, z, nx, ny, nz, color = 0xffd9a0, count = 6) {
    const n = Math.max(1, Math.round(count * this.scale));
    const c = new THREE.Color(color);
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
  }

  dispose() {
    this.tracerMesh.geometry.dispose(); this.tracerMesh.material.dispose();
    this.sparkMesh.geometry.dispose(); this.sparkMesh.material.dispose();
  }
}
