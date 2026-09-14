/**
 * world.js — transforme une définition de carte en :
 *   1. une géométrie fusionnée (un seul maillage => un seul draw call) ;
 *   2. un monde de collision AABB ;
 *   3. un graphe de points de navigation utilisé par les bots.
 *
 * La fusion est la principale optimisation du jeu : une carte de plusieurs
 * centaines de boîtes coûte autant à dessiner qu'un seul cube.
 */

import * as THREE from '../vendor/three.module.js';
import { CollisionWorld } from './collision.js';
import { PLAYER } from './config.js';

const FACES = [
  // [normale, 4 sommets en coordonnées unitaires (-0.5..0.5)]
  [[0, 0, 1],  [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  [[1, 0, 0],  [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
  [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
  [[0, 1, 0],  [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
  [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
];

/** Léger dégradé par face pour donner du volume sans lumière supplémentaire. */
const FACE_SHADE = [0.86, 0.80, 0.92, 0.78, 1.0, 0.62];

export function buildWorld(mapData) {
  const boxes = mapData.boxes;
  const nBox = boxes.length;
  const positions = new Float32Array(nBox * 24 * 3);
  const normals = new Float32Array(nBox * 24 * 3);
  const colors = new Float32Array(nBox * 24 * 3);
  const indices = new Uint32Array(nBox * 36);

  const col = new THREE.Color();
  let vp = 0, ip = 0, vi = 0;

  const collision = new CollisionWorld(6);
  const minimapRects = [];

  for (let b = 0; b < nBox; b++) {
    const box = boxes[b];
    const hw = box.w / 2, hd = box.d / 2;
    const cy = box.y + box.h / 2, hh = box.h / 2;
    col.setHex(box.color);

    for (let f = 0; f < 6; f++) {
      const [n, verts] = FACES[f];
      const shade = FACE_SHADE[f];
      for (let v = 0; v < 4; v++) {
        const p = verts[v];
        positions[vp] = box.x + p[0] * hw;
        positions[vp + 1] = cy + p[1] * hh;
        positions[vp + 2] = box.z + p[2] * hd;
        normals[vp] = n[0]; normals[vp + 1] = n[1]; normals[vp + 2] = n[2];
        colors[vp] = col.r * shade; colors[vp + 1] = col.g * shade; colors[vp + 2] = col.b * shade;
        vp += 3;
      }
      indices[ip] = vi; indices[ip + 1] = vi + 1; indices[ip + 2] = vi + 2;
      indices[ip + 3] = vi; indices[ip + 4] = vi + 2; indices[ip + 5] = vi + 3;
      ip += 6; vi += 4;
    }

    collision.addBox(box.x - hw, box.y, box.z - hd, box.x + hw, box.y + box.h, box.z + hd);
    // Mini-carte : on ne garde que ce qui fait obstacle à hauteur d'homme.
    // Sont donc exclus le sol, les plafonds et les toits plats en surplomb,
    // qui masqueraient toute la carte vue de dessus.
    const overhead = box.h <= 1.0 && box.y > 2.5;
    if (box.h > 0.5 && box.y + box.h > 0.6 && box.y < 12 && !overhead) {
      minimapRects.push({ x: box.x, z: box.z, w: box.w, d: box.d, top: box.y + box.h });
    }
  }
  collision.build();

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;

  const nav = buildNav(collision, mapData.size, mapData.sampleY || 40);

  return { mesh, geometry: geo, material: mat, collision, nav, minimapRects, mapData };
}

/**
 * Graphe de navigation généré automatiquement : on échantillonne une grille,
 * on garde les points où un acteur tient debout. Aucun navmesh à éditer à la main,
 * et une nouvelle carte devient jouable par les bots sans travail supplémentaire.
 */
function buildNav(collision, size, sampleY) {
  const step = 3.0;
  const half = size / 2 - 2.5;
  const nodes = [];
  const r = PLAYER.radius + 0.05;
  const h = PLAYER.heightStand;

  for (let x = -half; x <= half; x += step) {
    for (let z = -half; z <= half; z += step) {
      const hit = collision.raycast(x, sampleY, z, 0, -1, 0, sampleY + 20);
      if (!hit) continue;
      const y = sampleY - hit.dist;
      if (y < -0.5 || y > 20) continue;
      if (collision.overlaps(x - r, y + 0.1, z - r, x + r, y + h, z + r)) continue;
      nodes.push({ x, y, z });
    }
  }

  // Grille de recherche pour trouver rapidement les nœuds proches d'un point.
  const cell = 8;
  const map = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const k = Math.floor(nodes[i].x / cell) + ',' + Math.floor(nodes[i].z / cell);
    let a = map.get(k); if (!a) { a = []; map.set(k, a); }
    a.push(i);
  }

  return {
    nodes,
    cell,
    map,
    random() { return nodes[(Math.random() * nodes.length) | 0]; },
    near(x, z, radius, out) {
      out.length = 0;
      const c0 = Math.floor((x - radius) / cell), c1 = Math.floor((x + radius) / cell);
      const d0 = Math.floor((z - radius) / cell), d1 = Math.floor((z + radius) / cell);
      const r2 = radius * radius;
      for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
        const a = map.get(cx + ',' + cz); if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const n = nodes[a[i]];
          const dx = n.x - x, dz = n.z - z;
          if (dx * dx + dz * dz <= r2) out.push(n);
        }
      }
      return out;
    },
  };
}

/**
 * Éclairage : au plus deux sources, jamais plus. C'est un choix de performance
 * (chaque lumière supplémentaire recompile les matériaux et coûte à chaque pixel).
 * Les facteurs ci-dessous compensent l'éclairage « physique » de three.js,
 * où une intensité de 1 rend une scène très sombre.
 */
const HEMI_GAIN = 3.4;
const SUN_GAIN = 3.6;

export function setupLights(scene, mapData, shadows) {
  const hemi = new THREE.HemisphereLight(mapData.hemi.sky, mapData.hemi.ground, mapData.hemi.intensity * HEMI_GAIN);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(mapData.sun.color, mapData.sun.intensity * SUN_GAIN);
  const d = mapData.sun.dir;
  sun.position.set(d[0] * 60, d[1] * 60, d[2] * 60);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = mapData.size * 0.6;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0015;
  }
  scene.add(sun);
  return { hemi, sun };
}
