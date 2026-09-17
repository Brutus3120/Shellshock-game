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

/**
 * Une face = [normale, coin d'origine, vecteur U, vecteur V], en coordonnées
 * unitaires (-1..1, multipliées ensuite par les demi-dimensions de la boîte).
 *
 * Parcourir la face dans l'ordre o, o+U, o+U+V, o+V garde le sens
 * trigonométrique vu de l'extérieur — c'est ce qui permet de la subdiviser
 * en quads sans se soucier de l'orientation des triangles.
 */
const FACES = [
  [[0, 0, 1],  [-1, -1, 1],  [2, 0, 0],  [0, 2, 0]],
  [[0, 0, -1], [1, -1, -1],  [-2, 0, 0], [0, 2, 0]],
  [[1, 0, 0],  [1, -1, 1],   [0, 0, -2], [0, 2, 0]],
  [[-1, 0, 0], [-1, -1, -1], [0, 0, 2],  [0, 2, 0]],
  [[0, 1, 0],  [-1, 1, 1],   [2, 0, 0],  [0, 0, -2]],
  [[0, -1, 0], [-1, -1, -1], [2, 0, 0],  [0, 0, 2]],
];

/** Léger dégradé par face pour donner du volume sans lumière supplémentaire. */
const FACE_SHADE = [0.86, 0.80, 0.92, 0.78, 1.0, 0.62];

/**
 * Occlusion ambiante cuite dans les couleurs de sommet.
 *
 * L'idée : là où deux surfaces se rejoignent, la lumière ambiante arrive moins
 * bien. On mesure ça une seule fois, à la construction de la carte, en sondant
 * la présence de solide autour de chaque sommet ; le résultat est multiplié
 * dans la couleur du sommet, que le shader lit déjà. Coût au rendu : zéro.
 *
 * La contrepartie, c'est qu'une couleur de sommet ne peut varier qu'entre des
 * sommets : un sol de 54 m fait de deux triangles ne peut pas avoir d'ombre de
 * contact au pied des murs. Les faces sont donc découpées en quads d'au plus
 * `aoTile` mètres (voir QUALITY dans config.js). Ça multiplie les triangles,
 * pas les draw calls — la carte reste un seul maillage.
 */
const TILE_DEFAULT = 1.0;  // côté maximal d'un quad, si le preset n'en impose pas (m)
const MAX_DIV = 64;        // garde-fou sur les très grandes faces
const AO_DIST = 0.75;      // portée des sondes (m)
const AO_LIFT = 0.09;      // décalage le long de la normale, pour sortir de la face
const AO_PROBE = 0.05;     // demi-côté d'une boîte de sonde
const AO_STRENGTH = 0.72;  // 0 = aucun assombrissement, 1 = noir dans un angle fermé

/**
 * Les faces tournées vers le bas ne sont pas subdivisées : on ne les voit que
 * sous une passerelle ou un toit, et FACE_SHADE les assombrit déjà fortement.
 * Le dessous du sol, lui, représenterait à lui seul la moitié des quads d'une
 * carte pour quelque chose que personne ne verra jamais.
 */
const FACE_DOWN = 5;

/** Huit directions dans le plan de la face : 4 axes, 4 diagonales moins pesantes. */
const D = Math.SQRT1_2;
const AO_DIRS = [
  [1, 0, 1], [0, 1, 1], [-1, 0, 1], [0, -1, 1],
  [D, D, 0.75], [-D, D, 0.75], [-D, -D, 0.75], [D, -D, 0.75],
];
const AO_TOTAL = AO_DIRS.reduce((s, d) => s + d[2], 0);

/** Grille d'AO réutilisée d'une face à l'autre : aucune allocation par face. */
const aoGrid = new Float32Array((MAX_DIV + 1) * (MAX_DIV + 1));

/**
 * Facteur d'éclairage ambiant en un point de la surface, entre 1 (dégagé) et
 * 1 - AO_STRENGTH (coincé dans un angle).
 *
 * (px,py,pz) est le sommet, (nx,ny,nz) la normale de sa face, (ux..) et (vx..)
 * les deux axes unitaires du plan de la face.
 */
function sampleAO(collision, px, py, pz, nx, ny, nz, ux, uy, uz, vx, vy, vz) {
  // Le point de sonde est décollé de la face, sinon il touche toujours la boîte
  // à laquelle le sommet appartient.
  const cx = px + nx * AO_LIFT, cy = py + ny * AO_LIFT, cz = pz + nz * AO_LIFT;

  // Test grossier : rien de solide dans tout le voisinage ? On sort tout de
  // suite. En terrain dégagé, c'est le cas de la grande majorité des sommets,
  // et ça divise le temps de construction par plusieurs.
  const rx = Math.abs(ux) + Math.abs(vx), ry = Math.abs(uy) + Math.abs(vy), rz = Math.abs(uz) + Math.abs(vz);
  const ex = rx * AO_DIST + AO_PROBE + Math.abs(nx) * AO_PROBE;
  const ey = ry * AO_DIST + AO_PROBE + Math.abs(ny) * AO_PROBE;
  const ez = rz * AO_DIST + AO_PROBE + Math.abs(nz) * AO_PROBE;
  if (!collision.overlaps(cx - ex, cy - ey, cz - ez, cx + ex, cy + ey, cz + ez)) return 1;

  let occ = 0;
  for (let k = 0; k < AO_DIRS.length; k++) {
    const su = AO_DIRS[k][0] * AO_DIST, sv = AO_DIRS[k][1] * AO_DIST;
    const sx = cx + ux * su + vx * sv;
    const sy = cy + uy * su + vy * sv;
    const sz = cz + uz * su + vz * sv;
    if (collision.overlaps(sx - AO_PROBE, sy - AO_PROBE, sz - AO_PROBE,
                           sx + AO_PROBE, sy + AO_PROBE, sz + AO_PROBE)) occ += AO_DIRS[k][2];
  }
  return 1 - AO_STRENGTH * (occ / AO_TOTAL);
}

/** Nombre de subdivisions d'une arête de `len` mètres, en quads de `tile` mètres. */
function divisions(len, tile) {
  return Math.max(1, Math.min(MAX_DIV, Math.ceil(len / tile)));
}

/** Longueur en mètres d'un vecteur d'arête unitaire, rapporté à une boîte. */
function faceLen(E, box) {
  return Math.abs(E[0] * box.w / 2) + Math.abs(E[1] * box.h / 2) + Math.abs(E[2] * box.d / 2);
}

export function buildWorld(mapData, quality) {
  const boxes = mapData.boxes;
  const nBox = boxes.length;
  const tile = (quality && quality.aoTile) || TILE_DEFAULT;

  // 1. Collision d'abord : l'occlusion ambiante a besoin d'un monde interrogeable
  //    avant de pouvoir sonder quoi que ce soit.
  const collision = new CollisionWorld(6);
  const minimapRects = [];
  for (let b = 0; b < nBox; b++) {
    const box = boxes[b];
    const hw = box.w / 2, hd = box.d / 2;
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

  // 2. Combien de quads après subdivision ? On compte avant d'allouer, pour que
  //    les tableaux typés soient exactement à la bonne taille.
  let nQuad = 0;
  for (let b = 0; b < nBox; b++) {
    const box = boxes[b];
    for (let f = 0; f < 6; f++) {
      const [, , U, V] = FACES[f];
      if (f === FACE_DOWN) { nQuad += 1; continue; }
      nQuad += divisions(faceLen(U, box), tile) * divisions(faceLen(V, box), tile);
    }
  }

  const positions = new Float32Array(nQuad * 4 * 3);
  const normals = new Float32Array(nQuad * 4 * 3);
  const colors = new Float32Array(nQuad * 4 * 3);
  const indices = new Uint32Array(nQuad * 6);

  const col = new THREE.Color();
  let vp = 0, ip = 0, vi = 0;

  // 3. Géométrie fusionnée, une face à la fois, subdivisée et ombrée.
  for (let b = 0; b < nBox; b++) {
    const box = boxes[b];
    const hw = box.w / 2, hd = box.d / 2;
    const cy = box.y + box.h / 2, hh = box.h / 2;
    col.setHex(box.color);

    for (let f = 0; f < 6; f++) {
      const [n, o, U, V] = FACES[f];
      const shade = FACE_SHADE[f];

      // Repère de la face en coordonnées du monde.
      const ox = box.x + o[0] * hw, oy = cy + o[1] * hh, oz = box.z + o[2] * hd;
      const Ux = U[0] * hw, Uy = U[1] * hh, Uz = U[2] * hd;
      const Vx = V[0] * hw, Vy = V[1] * hh, Vz = V[2] * hd;
      const lu = Math.abs(Ux) + Math.abs(Uy) + Math.abs(Uz);
      const lv = Math.abs(Vx) + Math.abs(Vy) + Math.abs(Vz);
      const nu = f === FACE_DOWN ? 1 : divisions(lu, tile);
      const nv = f === FACE_DOWN ? 1 : divisions(lv, tile);
      // Axes unitaires du plan, pour orienter les sondes d'occlusion.
      // Une boîte d'épaisseur nulle donnerait ici une division par zéro, donc
      // des couleurs NaN sur toute la carte : dans ce cas on renonce à l'AO.
      const flat = lu < 1e-6 || lv < 1e-6;
      const ux = flat ? 0 : Ux / lu, uy = flat ? 0 : Uy / lu, uz = flat ? 0 : Uz / lu;
      const vx = flat ? 0 : Vx / lv, vy = flat ? 0 : Vy / lv, vz = flat ? 0 : Vz / lv;

      // Occlusion aux nœuds de la grille : (nu+1) × (nv+1) valeurs, calculées
      // une fois et relues par les quads qui les partagent.
      const row = nu + 1;
      for (let j = 0; j <= nv; j++) {
        const tv = j / nv;
        for (let i = 0; i <= nu; i++) {
          const tu = i / nu;
          const px = ox + Ux * tu + Vx * tv;
          const py = oy + Uy * tu + Vy * tv;
          const pz = oz + Uz * tu + Vz * tv;
          aoGrid[j * row + i] = flat
            ? 1
            : sampleAO(collision, px, py, pz, n[0], n[1], n[2], ux, uy, uz, vx, vy, vz);
        }
      }

      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          // Les quatre coins, dans l'ordre qui préserve le sens des triangles.
          for (let c = 0; c < 4; c++) {
            const ci = i + (c === 1 || c === 2 ? 1 : 0);
            const cj = j + (c === 2 || c === 3 ? 1 : 0);
            const tu = ci / nu, tv = cj / nv;
            positions[vp] = ox + Ux * tu + Vx * tv;
            positions[vp + 1] = oy + Uy * tu + Vy * tv;
            positions[vp + 2] = oz + Uz * tu + Vz * tv;
            normals[vp] = n[0]; normals[vp + 1] = n[1]; normals[vp + 2] = n[2];
            const k = shade * aoGrid[cj * row + ci];
            colors[vp] = col.r * k; colors[vp + 1] = col.g * k; colors[vp + 2] = col.b * k;
            vp += 3;
          }
          indices[ip] = vi; indices[ip + 1] = vi + 1; indices[ip + 2] = vi + 2;
          indices[ip + 3] = vi; indices[ip + 4] = vi + 2; indices[ip + 5] = vi + 3;
          ip += 6; vi += 4;
        }
      }
    }
  }

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
 * Fusionne une liste de boîtes en une géométrie unique à couleur par sommet.
 *
 * Même principe que la fusion de la carte ci-dessus, mais à l'échelle d'un
 * personnage : c'est ce qui permet à un bot de tenir en quatre draw calls au
 * lieu de neuf (voir `buildBotMesh` dans bots.js). Ni subdivision ni occlusion
 * ambiante : une pièce de vingt centimètres n'y gagnerait rien de visible, et
 * la facture serait payée une fois par bot.
 *
 * `parts` : `[{ w, h, d, x, y, z, color, ry }]`. x/y/z désignent le CENTRE de
 * la boîte, comme une `BoxGeometry` — et non sa base comme le helper `B` de
 * maps.js. `ry` est facultatif : une rotation autour de Y, cuite dans les
 * sommets et les normales.
 */
export function mergeBoxGeometry(parts) {
  const n = parts.length;
  const positions = new Float32Array(n * 24 * 3);
  const normals = new Float32Array(n * 24 * 3);
  const colors = new Float32Array(n * 24 * 3);
  // Uint16 suffit très largement à un personnage ; le garde-fou évite qu'un
  // appel plus gourmand ne dépasse 65 535 sommets sans rien dire.
  const indices = n * 24 > 65535 ? new Uint32Array(n * 36) : new Uint16Array(n * 36);

  const col = new THREE.Color();
  let vp = 0, ip = 0, vi = 0;

  for (let b = 0; b < n; b++) {
    const part = parts[b];
    const hw = part.w / 2, hh = part.h / 2, hd = part.d / 2;
    const ry = part.ry || 0;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    // setHex et pas un décalage de bits : c'est lui qui applique la conversion
    // sRGB → linéaire de r169, comme pour le décor juste au-dessus.
    col.setHex(part.color);

    for (let f = 0; f < 6; f++) {
      const [N, O, U, V] = FACES[f];
      for (let v = 0; v < 4; v++) {
        // o, o+U, o+U+V, o+V : le tour de la face dans le sens trigonométrique.
        const u = (v === 1 || v === 2) ? 1 : 0;
        const t = (v === 2 || v === 3) ? 1 : 0;
        const lx = (O[0] + U[0] * u + V[0] * t) * hw;
        const ly = (O[1] + U[1] * u + V[1] * t) * hh;
        const lz = (O[2] + U[2] * u + V[2] * t) * hd;
        positions[vp] = part.x + lx * cs + lz * sn;
        positions[vp + 1] = part.y + ly;
        positions[vp + 2] = part.z - lx * sn + lz * cs;
        normals[vp] = N[0] * cs + N[2] * sn;
        normals[vp + 1] = N[1];
        normals[vp + 2] = -N[0] * sn + N[2] * cs;
        colors[vp] = col.r; colors[vp + 1] = col.g; colors[vp + 2] = col.b;
        vp += 3;
      }
      indices[ip] = vi; indices[ip + 1] = vi + 1; indices[ip + 2] = vi + 2;
      indices[ip + 3] = vi; indices[ip + 4] = vi + 2; indices[ip + 5] = vi + 3;
      ip += 6; vi += 4;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  return geo;
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

/**
 * Ciel en dégradé : une sphère retournée, deux teintes lues dans la carte.
 *
 * Il ne remplace pas seulement un aplat par un dégradé, il répare un raccord.
 * `scene.background` est une couleur d'effacement du framebuffer : elle ne
 * passe PAS par le tone mapping, alors que le brouillard, calculé dans le
 * shader, y passe. Depuis l'étape 3 le décor lointain converge donc vers une
 * couleur que le fond ne suit plus — un mur mesuré à (17,27,44) avant, (3,11,27)
 * après, pour un fond resté à (42,49,66). Un ciel en géométrie est tone-mappé
 * comme le reste : le raccord redevient invisible, à condition que `skyBottom`
 * soit la couleur de brouillard de la carte.
 *
 * `MeshBasicMaterial` et non Lambert : le ciel ne s'éclaire pas, l'invariant
 * des deux lumières tient.
 *
 * Il est dessiné EN DERNIER de la passe opaque, et non en premier comme un fond
 * classique : il teste le tampon de profondeur sans y écrire, donc un vrai GPU
 * rejette avant ombrage les pixels déjà couverts par le décor. Mesuré sous
 * swiftshader, qui n'a pas de rejet précoce utile, la différence est nulle
 * (22,2 / 22,5 contre 22,3 / 23,8 ips) : on garde l'ordre pour le matériel réel,
 * sans en attendre quoi que ce soit ici. Les effets additifs passent après, dans
 * la passe transparente, donc ils restent visibles devant le ciel.
 */
export function buildSky(mapData, fogFar) {
  const radius = fogFar + 20;             // au-delà du brouillard, en deçà du plan lointain
  const geo = new THREE.SphereGeometry(radius, 16, 10);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const top = new THREE.Color().setHex(mapData.skyTop);
  const bottom = new THREE.Color().setHex(mapData.skyBottom);
  for (let i = 0; i < pos.count; i++) {
    // Le dégradé ne vit que dans l'hémisphère SUPÉRIEUR : 0 pile à l'horizon,
    // 1 au zénith, et tout ce qui est sous l'horizon reste à `skyBottom`.
    // C'est ce qui garantit la propriété qui fait tout l'intérêt de ce ciel —
    // la ligne d'horizon a exactement la couleur vers laquelle le brouillard
    // converge. Paramétrer sur la sphère entière la mettrait déjà à 61 % du
    // haut, et le raccord se verrait.
    const t = Math.pow(Math.max(0, pos.getY(i)) / radius, 0.8);
    const o = i * 3;
    colors[o] = bottom.r + (top.r - bottom.r) * t;
    colors[o + 1] = bottom.g + (top.g - bottom.g) * t;
    colors[o + 2] = bottom.b + (top.b - bottom.b) * t;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute('normal');          // inutile à un matériau Basic
  geo.deleteAttribute('uv');

  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;                // après le décor, avant les effets additifs
  return mesh;
}

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
