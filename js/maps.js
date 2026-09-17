/**
 * maps.js — les quatre cartes originales.
 *
 * Une carte = une liste de boîtes alignées sur les axes. C'est le seul primitif
 * du jeu : le décor, les caisses, les escaliers et les toits en sont faits.
 * Avantage direct : la géométrie fusionne en un seul maillage (1 draw call)
 * et la collision reste triviale.
 *
 * Convention d'une boîte : x/z = centre, y = BASE (sol), w/h/d = dimensions.
 */

// ---------------------------------------------------------------- helpers ---

const B = (x, y, z, w, h, d, color) => ({ x, y, z, w, h, d, color });

/** Enceinte : quatre murs autour d'une zone carrée centrée sur l'origine. */
function perimeter(out, size, height, thick, color) {
  const s = size / 2 + thick / 2;
  out.push(B(0, 0,  s, size + thick * 2, height, thick, color));
  out.push(B(0, 0, -s, size + thick * 2, height, thick, color));
  out.push(B( s, 0, 0, thick, height, size + thick * 2, color));
  out.push(B(-s, 0, 0, thick, height, size + thick * 2, color));
}

/**
 * Escalier plein. `dir` indique le sens de montée.
 * Chaque marche est un bloc partant du sol : aucun trou dessous, aucune pente.
 */
function stairs(out, { x, y = 0, z, dir, steps, width, stepH = 0.5, stepD = 1.0, color }) {
  for (let i = 0; i < steps; i++) {
    const h = (i + 1) * stepH;
    const off = (i + 0.5) * stepD;
    if (dir === '+x')      out.push(B(x + off, y, z, stepD, h, width, color));
    else if (dir === '-x') out.push(B(x - off, y, z, stepD, h, width, color));
    else if (dir === '+z') out.push(B(x, y, z + off, width, h, stepD, color));
    else                   out.push(B(x, y, z - off, width, h, stepD, color));
  }
}

/** Mur percé d'une porte centrale (deux segments + linteau). */
function wallWithDoor(out, { x, y = 0, z, len, height, thick, axis, doorW = 3, doorH = 3, color }) {
  const side = (len - doorW) / 2;
  if (axis === 'x') {
    out.push(B(x - (doorW / 2 + side / 2), y, z, side, height, thick, color));
    out.push(B(x + (doorW / 2 + side / 2), y, z, side, height, thick, color));
    if (height > doorH) out.push(B(x, y + doorH, z, doorW, height - doorH, thick, color));
  } else {
    out.push(B(x, y, z - (doorW / 2 + side / 2), thick, height, side, color));
    out.push(B(x, y, z + (doorW / 2 + side / 2), thick, height, side, color));
    if (height > doorH) out.push(B(x, y + doorH, z, thick, height - doorH, doorW, color));
  }
}

/** Bâtiment creux : 4 murs percés + toit praticable. */
function building(out, { x, z, w, d, height, thick = 0.6, doors = 'nsew', roof = true, colorWall, colorRoof }) {
  if (doors.includes('n')) wallWithDoor(out, { x, z: z - d / 2, len: w, height, thick, axis: 'x', color: colorWall });
  else out.push(B(x, 0, z - d / 2, w, height, thick, colorWall));
  if (doors.includes('s')) wallWithDoor(out, { x, z: z + d / 2, len: w, height, thick, axis: 'x', color: colorWall });
  else out.push(B(x, 0, z + d / 2, w, height, thick, colorWall));
  if (doors.includes('w')) wallWithDoor(out, { x: x - w / 2, z, len: d, height, thick, axis: 'z', color: colorWall });
  else out.push(B(x - w / 2, 0, z, thick, height, d, colorWall));
  if (doors.includes('e')) wallWithDoor(out, { x: x + w / 2, z, len: d, height, thick, axis: 'z', color: colorWall });
  else out.push(B(x + w / 2, 0, z, thick, height, d, colorWall));
  if (roof) out.push(B(x, height, z, w + thick, 0.5, d + thick, colorRoof));
}

// ------------------------------------------------------- CARTE 1 : ARÈNE ---

function mapArene() {
  const C = { sol: 0x6b7382, mur: 0x515a6a, plate: 0x8d97aa, caisse: 0xc4713f, accent: 0x4fc3a1 };
  const o = [];
  const S = 54;
  o.push(B(0, -1, 0, S, 1, S, C.sol));
  perimeter(o, S, 10, 1.2, C.mur);

  // Plateforme centrale en gradins + quatre accès.
  o.push(B(0, 0, 0, 15, 2.4, 15, C.plate));
  o.push(B(0, 2.4, 0, 6, 0.9, 6, C.accent));
  stairs(o, { x: 7.5, z: 0, dir: '+x', steps: 5, width: 5, stepH: 0.48, stepD: 1.1, color: C.plate });
  stairs(o, { x: -7.5, z: 0, dir: '-x', steps: 5, width: 5, stepH: 0.48, stepD: 1.1, color: C.plate });
  stairs(o, { x: 0, z: 7.5, dir: '+z', steps: 5, width: 5, stepH: 0.48, stepD: 1.1, color: C.plate });
  stairs(o, { x: 0, z: -7.5, dir: '-z', steps: 5, width: 5, stepH: 0.48, stepD: 1.1, color: C.plate });

  // Coursives surélevées est / ouest.
  for (const sx of [-1, 1]) {
    o.push(B(sx * 21, 3.6, 0, 5, 0.6, 30, C.plate));
    o.push(B(sx * 23.2, 4.2, 0, 0.6, 1.1, 30, C.mur));
    stairs(o, { x: sx * 21, z: 17, dir: '-z', steps: 8, width: 5, stepH: 0.48, stepD: 1.0, color: C.plate });
  }

  // Piliers d'angle + caisses de couverture.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    o.push(B(sx * 15, 0, sz * 15, 3, 6.5, 3, C.mur));
    o.push(B(sx * 9, 0, sz * 20, 2.4, 1.3, 2.4, C.caisse));
    o.push(B(sx * 20, 0, sz * 9, 2.4, 1.3, 2.4, C.caisse));
  }
  o.push(B(0, 0, 21, 6, 1.6, 1.6, C.caisse));
  o.push(B(0, 0, -21, 6, 1.6, 1.6, C.caisse));

  return {
    id: 'arene',
    name: 'Arène Cendrée',
    desc: 'Petite arène ouverte, plateforme centrale et coursives. Duels immédiats.',
    tagline: 'Ouverte · rapide',
    sky: 0x2a3142, fog: 0x2a3142, ground: C.sol,
    exposure: 1.10,          // sol clair et ciel de nuit : la courbe suffit, on ne rattrape qu'un peu les noirs
    sampleY: 40,
    sun: { color: 0xffe7c4, intensity: 1.05, dir: [0.4, 1, 0.25] },
    hemi: { sky: 0x6f8fb5, ground: 0x34302c, intensity: 0.85 },
    size: S,
    boxes: o,
    spawns: [
      [0, 22], [0, -22], [22, 0], [-22, 0],
      [17, 17], [-17, -17], [17, -17], [-17, 17],
      [0, 10], [0, -10], [10, 0], [-10, 0],
    ],
    pickups: [
      { type: 'health', x: 0, z: 0 },
      { type: 'ammo', x: 20, z: 20 }, { type: 'ammo', x: -20, z: -20 },
      { type: 'health', x: 20, z: -20 }, { type: 'health', x: -20, z: 20 },
    ],
  };
}

// ---------------------------------------------------- CARTE 2 : QUARTIER ---

function mapQuartier() {
  const C = { sol: 0x4c5150, mur: 0x8d8577, mur2: 0x6f6a60, toit: 0xc2734a, accent: 0x2f9e8f, caisse: 0x4a5a6b };
  const o = [];
  const S = 78;
  o.push(B(0, -1, 0, S, 1, S, C.sol));
  perimeter(o, S, 14, 1.4, C.mur2);

  // Six bâtiments creux et praticables sur les toits.
  const plots = [
    [-22, -22, 16, 13, 6], [ 22, -22, 16, 13, 7],
    [-22,  22, 16, 13, 7], [ 22,  22, 16, 13, 6],
    [-24,   0, 11, 14, 5], [ 24,   0, 11, 14, 5],
  ];
  for (const [x, z, w, d, h] of plots) {
    building(o, { x, z, w, d, height: h, doors: 'nsew', colorWall: (x + z) % 2 ? C.mur : C.mur2, colorRoof: C.toit });
  }
  // Escaliers extérieurs vers les toits.
  stairs(o, { x: -22, z: -13.5, dir: '-z', steps: 12, width: 4, stepH: 0.52, stepD: 1.0, color: C.mur2 });
  stairs(o, { x:  22, z:  13.5, dir: '+z', steps: 14, width: 4, stepH: 0.52, stepD: 1.0, color: C.mur2 });
  stairs(o, { x: -30, z:  22,  dir: '-x', steps: 14, width: 4, stepH: 0.52, stepD: 1.0, color: C.mur2 });
  stairs(o, { x:  30, z: -22,  dir: '+x', steps: 12, width: 4, stepH: 0.52, stepD: 1.0, color: C.mur2 });

  // Passerelles reliant les toits : on récompense la prise de hauteur.
  o.push(B(0, 6.2, -22, 12, 0.4, 3, C.accent));
  o.push(B(0, 6.2,  22, 12, 0.4, 3, C.accent));
  o.push(B(-22, 5.6, 0, 3, 0.4, 12, C.accent));
  o.push(B( 22, 5.6, 0, 3, 0.4, 12, C.accent));

  // Place centrale : blockhaus bas + couverture.
  building(o, { x: 0, z: 0, w: 13, d: 13, height: 3.2, doors: 'nsew', colorWall: C.mur, colorRoof: C.toit });
  stairs(o, { x: 8, z: 0, dir: '-x', steps: 6, width: 3.5, stepH: 0.55, stepD: 1.0, color: C.mur2 });
  for (const [x, z] of [[-9, -9], [9, 9], [-9, 9], [9, -9], [0, 14], [0, -14], [14, 0], [-14, 0]]) {
    o.push(B(x, 0, z, 2.6, 1.4, 2.6, C.caisse));
  }
  for (const [x, z] of [[-34, -8], [34, 8], [-8, 34], [8, -34]]) {
    o.push(B(x, 0, z, 5, 2.2, 2, C.caisse));
  }

  return {
    id: 'quartier',
    name: 'Quartier Béton',
    desc: 'Plusieurs bâtiments traversables, toits reliés par des passerelles.',
    tagline: 'Bâtiments · verticalité',
    sky: 0x3b4050, fog: 0x3b4050, ground: C.sol,
    exposure: 1.22,          // la carte la plus grise : sans rattrapage elle perd 9 % de luminance
    sampleY: 40,
    sun: { color: 0xfff0d0, intensity: 1.0, dir: [-0.35, 1, 0.4] },
    hemi: { sky: 0x8aa0bd, ground: 0x3a352e, intensity: 0.8 },
    size: S,
    boxes: o,
    spawns: [
      [0, 34], [0, -34], [34, 0], [-34, 0],
      [-33, -33], [33, 33], [33, -33], [-33, 33],
      [0, 16], [0, -16], [16, 0], [-16, 0],
    ],
    pickups: [
      { type: 'health', x: 0, z: 0 },
      { type: 'ammo', x: -22, z: -22 }, { type: 'ammo', x: 22, z: 22 },
      { type: 'health', x: -30, z: 30 }, { type: 'health', x: 30, z: -30 },
      { type: 'ammo', x: 0, z: 30 }, { type: 'ammo', x: 0, z: -30 },
    ],
  };
}

// ------------------------------------------------------ CARTE 3 : BUNKER ---

function mapBunker() {
  const C = { sol: 0x4e555e, mur: 0x6e7684, mur2: 0x5b6370, toit: 0x343a42, neon: 0x7bf0d8, caisse: 0x9a6740 };
  const o = [];
  const S = 62;
  const H = 4.6;
  o.push(B(0, -1, 0, S, 1, S, C.sol));
  perimeter(o, S, H + 1.2, 1.4, C.mur);
  o.push(B(0, H, 0, S + 2, 0.8, S + 2, C.toit));   // plafond : on est à l'intérieur

  // Grille de salles reliées par des portes : beaucoup de chemins courts.
  const grid = [-20, -6.7, 6.7, 20];
  for (let i = 0; i < grid.length; i++) {
    const gx = grid[i];
    if (i > 0) {
      // cloison verticale (le long de Z) percée de deux portes
      const mid = (grid[i] + grid[i - 1]) / 2;
      for (const seg of [[-22, 12], [-4, 8], [10, 12]]) {
        o.push(B(mid, 0, seg[0] + seg[1] / 2, 0.7, H, seg[1], C.mur2));
      }
      // cloison horizontale (le long de X)
      for (const seg of [[-22, 12], [-4, 8], [10, 12]]) {
        o.push(B(seg[0] + seg[1] / 2, 0, mid, seg[1], H, 0.7, C.mur2));
      }
    }
    void gx;
  }

  // Salle centrale ouverte avec estrade et néons.
  o.push(B(0, 0, 0, 9, 1.2, 9, C.mur));
  o.push(B(0, 1.2, 0, 5, 0.4, 5, C.neon));
  stairs(o, { x: 4.5, z: 0, dir: '+x', steps: 3, width: 4, stepH: 0.4, stepD: 0.9, color: C.mur });
  stairs(o, { x: -4.5, z: 0, dir: '-x', steps: 3, width: 4, stepH: 0.4, stepD: 0.9, color: C.mur });

  // Coursives basses dans les quatre coins, atteignables par escaliers.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    o.push(B(sx * 24, 2.3, sz * 24, 10, 0.4, 10, C.mur));
    stairs(o, { x: sx * 24, z: sz * 18.5, dir: sz > 0 ? '-z' : '+z', steps: 5, width: 3.5, stepH: 0.47, stepD: 0.95, color: C.mur2 });
    o.push(B(sx * 13, 0, sz * 13, 2.2, 1.3, 2.2, C.caisse));
  }

  // Bandeaux lumineux décoratifs (simples boîtes plates, aucune lumière réelle).
  for (const z of [-26, 0, 26]) o.push(B(0, H - 0.35, z, S - 6, 0.15, 0.5, C.neon));

  return {
    id: 'bunker',
    name: 'Bunker Halogène',
    desc: 'Couloirs, salles fermées et angles courts. Le fusil à pompe y règne.',
    tagline: 'Intérieur · couloirs',
    sky: 0x1b2026, fog: 0x1b2026, ground: C.sol,
    exposure: 1.20,          // intérieur sans soleil : c'est là que les noirs se bouchent le plus
    // Carte fermée : on sonde le sol SOUS le plafond, sinon points de
    // réapparition et navigation atterriraient sur le toit du bunker.
    sampleY: H - 0.5,
    sun: { color: 0xcfe4ff, intensity: 0.75, dir: [0.2, 1, -0.3] },
    hemi: { sky: 0x8fa6ba, ground: 0x3a4048, intensity: 1.55 },
    size: S,
    boxes: o,
    spawns: [
      [-26, -26], [26, 26], [26, -26], [-26, 26],
      [0, 26], [0, -26], [26, 0], [-26, 0],
      [-13, 0], [13, 0], [0, 13], [0, -13],
    ],
    pickups: [
      { type: 'health', x: 0, z: 0 },
      { type: 'ammo', x: -26, z: 0 }, { type: 'ammo', x: 26, z: 0 },
      { type: 'health', x: 0, z: 26 }, { type: 'health', x: 0, z: -26 },
    ],
  };
}

// ------------------------------------------------------- CARTE 4 : CRÊTE ---

function mapCrete() {
  const C = { sol: 0x8a6a42, roche: 0x9d7c4e, roche2: 0x77613f, haut: 0xc2a06a, mur: 0x5d4a30, vert: 0x5f7b46 };
  const o = [];
  const S = 84;
  o.push(B(0, -1, 0, S, 1, S, C.sol));
  perimeter(o, S, 16, 1.6, C.mur);

  // Plateaux étagés : le relief est fait de blocs empilés, pas de terrain.
  const plateaus = [
    [-26, -26, 20, 18, 2.0, C.roche],
    [ 26, -24, 22, 16, 3.5, C.roche2],
    [-28,  26, 18, 20, 4.5, C.roche2],
    [ 24,  26, 20, 18, 2.5, C.roche],
    [  0, -30, 18, 10, 1.5, C.roche],
    [  0,  30, 18, 10, 1.5, C.roche],
  ];
  for (const [x, z, w, d, h, col] of plateaus) o.push(B(x, 0, z, w, h, d, col));

  // Rampes d'accès (escaliers) vers chaque plateau.
  stairs(o, { x: -14.5, z: -26, dir: '-x', steps: 5, width: 6, stepH: 0.42, stepD: 1.1, color: C.roche });
  stairs(o, { x:  14.5, z: -24, dir: '+x', steps: 8, width: 6, stepH: 0.45, stepD: 1.1, color: C.roche2 });
  stairs(o, { x: -28,   z:  15, dir: '+z', steps: 10, width: 6, stepH: 0.46, stepD: 1.1, color: C.roche2 });
  stairs(o, { x:  24,   z:  16, dir: '+z', steps: 6, width: 6, stepH: 0.43, stepD: 1.1, color: C.roche });
  stairs(o, { x: 0, z: -24.5, dir: '-z', steps: 4, width: 8, stepH: 0.4, stepD: 1.1, color: C.roche });
  stairs(o, { x: 0, z:  24.5, dir: '+z', steps: 4, width: 8, stepH: 0.4, stepD: 1.1, color: C.roche });

  // Crête centrale : le point haut de la carte, exposé mais dominant.
  o.push(B(0, 0, 0, 14, 6.0, 14, C.haut));
  o.push(B(0, 6.0, 0, 8, 1.6, 8, C.haut));
  o.push(B(0, 7.6, 0, 9, 0.6, 9, C.roche2));
  stairs(o, { x: 7, z: 4, dir: '+x', steps: 12, width: 4, stepH: 0.5, stepD: 1.0, color: C.haut });
  stairs(o, { x: -7, z: -4, dir: '-x', steps: 12, width: 4, stepH: 0.5, stepD: 1.0, color: C.haut });
  // Garde-corps partiels : de la couverture en hauteur.
  for (const [x, z, w, d] of [[0, -4.4, 9, 0.6], [0, 4.4, 9, 0.6], [-4.4, 0, 0.6, 9], [4.4, 0, 0.6, 9]]) {
    o.push(B(x, 8.2, z, w, 1.1, d, C.roche2));
  }

  // Rochers et bosquets de couverture, répartis pour casser les longues lignes.
  const rocks = [
    [-10, -12, 3.5, 2.4, 3], [12, -10, 4, 2.0, 3.5], [-12, 12, 3, 2.6, 3],
    [11, 13, 3.5, 2.2, 3], [-34, 0, 5, 3.2, 5], [34, 0, 5, 3.2, 5],
    [0, -14, 6, 1.6, 2], [0, 14, 6, 1.6, 2], [-18, -2, 2.4, 2.8, 2.4], [18, 2, 2.4, 2.8, 2.4],
  ];
  for (const [x, z, w, h, d] of rocks) o.push(B(x, 0, z, w, h, d, C.roche2));
  for (const [x, z] of [[-30, -12], [30, 12], [-12, 30], [12, -30], [-36, 30], [36, -30]]) {
    o.push(B(x, 0, z, 2.2, 3.2, 2.2, C.vert));
  }

  return {
    id: 'crete',
    name: 'Crête Ocre',
    desc: 'Reliefs étagés et point haut central. Portées longues, flancs couverts.',
    tagline: 'Relief · hauteurs',
    sky: 0x6b5a44, fog: 0x6b5a44, ground: C.sol,
    exposure: 1.10,          // plein soleil : le gain est surtout dans le rouleau des hautes lumières
    sampleY: 40,
    sun: { color: 0xffd9a0, intensity: 1.15, dir: [0.5, 0.9, -0.35] },
    hemi: { sky: 0xc9a878, ground: 0x4a3c28, intensity: 0.75 },
    size: S,
    boxes: o,
    spawns: [
      [-36, -36], [36, 36], [36, -36], [-36, 36],
      [0, 36], [0, -36], [36, 0], [-36, 0],
      [-20, 0], [20, 0], [0, 20], [0, -20],
    ],
    pickups: [
      { type: 'health', x: 0, z: 0 },
      { type: 'ammo', x: -26, z: -26 }, { type: 'ammo', x: 26, z: 26 },
      { type: 'health', x: -34, z: 12 }, { type: 'health', x: 34, z: -12 },
      { type: 'ammo', x: 0, z: 32 },
    ],
  };
}

// ------------------------------------------------------------------ index ---

export const MAPS = {
  arene: mapArene,
  quartier: mapQuartier,
  bunker: mapBunker,
  crete: mapCrete,
};

export const MAP_ORDER = ['arene', 'quartier', 'bunker', 'crete'];

/** Métadonnées légères pour le menu, sans construire la géométrie. */
export const MAP_INFO = MAP_ORDER.map((id) => {
  const m = MAPS[id]();
  return { id, name: m.name, desc: m.desc, tagline: m.tagline, sky: m.sky, ground: m.ground, size: m.size };
});

export function buildMapData(id) {
  const f = MAPS[id] || MAPS.arene;
  return f();
}
