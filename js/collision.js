/**
 * collision.js — physique du jeu : AABB uniquement, aucune librairie externe.
 *
 * Le monde entier est une liste de boîtes alignées sur les axes, rangées dans
 * une grille uniforme en XZ (broad-phase). C'est volontairement primitif :
 * une collision AABB coûte quelques comparaisons, ce qui laisse tout le budget
 * CPU au rendu et à l'IA, même sur une machine modeste.
 *
 * Les pentes sont remplacées par des marches ("step-up" automatique) : on garde
 * la verticalité sans jamais avoir besoin de géométrie non alignée.
 */

const EPS = 1e-4;

export class CollisionWorld {
  constructor(cellSize = 6) {
    this.cellSize = cellSize;
    this.boxes = [];          // {minX,minY,minZ,maxX,maxY,maxZ}
    this.cells = new Map();   // "ix,iz" -> [indices]
    this._stamp = null;
    this._stampId = 0;
    this.bounds = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  }

  addBox(minX, minY, minZ, maxX, maxY, maxZ) {
    this.boxes.push({ minX, minY, minZ, maxX, maxY, maxZ });
  }

  /** Range les boîtes dans la grille. À appeler une fois la carte construite. */
  build() {
    this.cells.clear();
    const cs = this.cellSize;
    let bMinX = Infinity, bMinZ = Infinity, bMaxX = -Infinity, bMaxZ = -Infinity;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      bMinX = Math.min(bMinX, b.minX); bMaxX = Math.max(bMaxX, b.maxX);
      bMinZ = Math.min(bMinZ, b.minZ); bMaxZ = Math.max(bMaxZ, b.maxZ);
      const x0 = Math.floor(b.minX / cs), x1 = Math.floor(b.maxX / cs);
      const z0 = Math.floor(b.minZ / cs), z1 = Math.floor(b.maxZ / cs);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const k = x + ',' + z;
          let arr = this.cells.get(k);
          if (!arr) { arr = []; this.cells.set(k, arr); }
          arr.push(i);
        }
      }
    }
    this.bounds = { minX: bMinX, minZ: bMinZ, maxX: bMaxX, maxZ: bMaxZ };
    this._stamp = new Int32Array(this.boxes.length);
    this._stampId = 0;
  }

  /** Indices des boîtes candidates chevauchant une AABB. */
  query(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const cs = this.cellSize;
    const id = ++this._stampId;
    const st = this._stamp;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs), z1 = Math.floor(maxZ / cs);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const arr = this.cells.get(x + ',' + z);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const bi = arr[i];
          if (st[bi] === id) continue;
          st[bi] = id;
          out.push(bi);
        }
      }
    }
    return out;
  }

  /** Vrai si l'AABB donnée traverse au moins une boîte solide. */
  overlaps(minX, minY, minZ, maxX, maxY, maxZ) {
    const cand = _scratch;
    this.query(minX, minZ, maxX, maxZ, cand);
    for (let i = 0; i < cand.length; i++) {
      const b = this.boxes[cand[i]];
      if (minX < b.maxX && maxX > b.minX &&
          minY < b.maxY && maxY > b.minY &&
          minZ < b.maxZ && maxZ > b.minZ) return true;
    }
    return false;
  }

  /**
   * Lancer de rayon contre le décor (algorithme des "slabs" + parcours DDA
   * de la grille pour ne tester que les cellules traversées).
   * Retourne { dist, nx, ny, nz } ou null.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const cs = this.cellSize;
    let best = maxDist, bnx = 0, bny = 0, bnz = 0, hit = false;
    const id = ++this._stampId;
    const st = this._stamp;

    let cx = Math.floor(ox / cs);
    let cz = Math.floor(oz / cs);
    const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
    const tDeltaX = stepX !== 0 ? Math.abs(cs / dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(cs / dz) : Infinity;
    let tMaxX = stepX !== 0
      ? (((stepX > 0 ? (cx + 1) * cs : cx * cs) - ox) / dx) : Infinity;
    let tMaxZ = stepZ !== 0
      ? (((stepZ > 0 ? (cz + 1) * cs : cz * cs) - oz) / dz) : Infinity;

    let t = 0;
    let guard = 0;
    while (t <= maxDist && guard++ < 512) {
      const arr = this.cells.get(cx + ',' + cz);
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          const bi = arr[i];
          if (st[bi] === id) continue;
          st[bi] = id;
          const b = this.boxes[bi];
          const r = rayBox(ox, oy, oz, dx, dy, dz, b, best);
          if (r && r.t < best) { best = r.t; bnx = r.nx; bny = r.ny; bnz = r.nz; hit = true; }
        }
      }
      if (tMaxX < tMaxZ) { t = tMaxX; cx += stepX; tMaxX += tDeltaX; }
      else               { t = tMaxZ; cz += stepZ; tMaxZ += tDeltaZ; }
      if (!isFinite(t)) break;
    }
    return hit ? { dist: best, nx: bnx, ny: bny, nz: bnz } : null;
  }

  /** Raccourci booléen : y a-t-il un mur entre A et B ? */
  blocked(ax, ay, az, bx, by, bz) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-5) return false;
    dx /= d; dy /= d; dz /= d;
    const hit = this.raycast(ax, ay, az, dx, dy, dz, d - 0.05);
    return hit !== null;
  }

  /** Hauteur du sol sous un point (pour poser les spawns / objets). */
  groundHeight(x, z, fromY = 60) {
    const hit = this.raycast(x, fromY, z, 0, -1, 0, fromY + 5);
    return hit ? fromY - hit.dist : 0;
  }
}

const _scratch = [];

/** Intersection rayon / AABB. Retourne le t d'entrée et la normale touchée. */
function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT;
  let nx = 0, ny = 0, nz = 0;

  // X
  if (Math.abs(dx) < 1e-8) {
    if (ox < b.minX || ox > b.maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (b.minX - ox) * inv, t2 = (b.maxX - ox) * inv;
    let n = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Y
  if (Math.abs(dy) < 1e-8) {
    if (oy < b.minY || oy > b.maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (b.minY - oy) * inv, t2 = (b.maxY - oy) * inv;
    let n = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Z
  if (Math.abs(dz) < 1e-8) {
    if (oz < b.minZ || oz > b.maxZ) return null;
  } else {
    const inv = 1 / dz;
    let t1 = (b.minZ - oz) * inv, t2 = (b.maxZ - oz) * inv;
    let n = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = n; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || tmin > maxT) return null;
  return { t: tmin, nx, ny, nz };
}

/**
 * Déplace une capsule approximée par une AABB (rayon r, hauteur h, pos = pieds).
 * Résolution axe par axe, avec franchissement automatique des marches.
 * Retourne { onGround, hitCeiling, hitWall }.
 */
export function moveActor(world, pos, r, h, disp, stepHeight) {
  let onGround = false, hitCeiling = false, hitWall = false;

  // --- Y ---
  if (disp.y !== 0) {
    pos.y += disp.y;
    const push = resolveY(world, pos, r, h, disp.y);
    if (push) {
      if (disp.y < 0) onGround = true; else hitCeiling = true;
    }
  }

  // --- X puis Z, avec tentative de marche ---
  if (disp.x !== 0) hitWall = axisMove(world, pos, r, h, 'x', disp.x, stepHeight) || hitWall;
  if (disp.z !== 0) hitWall = axisMove(world, pos, r, h, 'z', disp.z, stepHeight) || hitWall;

  // Le sol est-il juste sous nos pieds ? (utile après un step-up)
  if (!onGround && disp.y <= 0) {
    if (world.overlaps(pos.x - r, pos.y - 0.06, pos.z - r, pos.x + r, pos.y + 0.02, pos.z + r)) onGround = true;
  }
  return { onGround, hitCeiling, hitWall };
}

function resolveY(world, pos, r, h, dy) {
  const cand = [];
  world.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, cand);
  let moved = false;
  for (let i = 0; i < cand.length; i++) {
    const b = world.boxes[cand[i]];
    if (pos.x - r < b.maxX && pos.x + r > b.minX &&
        pos.z - r < b.maxZ && pos.z + r > b.minZ &&
        pos.y < b.maxY && pos.y + h > b.minY) {
      if (dy < 0) { if (b.maxY > pos.y) { pos.y = b.maxY + EPS; moved = true; } }
      else        { if (b.minY < pos.y + h) { pos.y = b.minY - h - EPS; moved = true; } }
    }
  }
  return moved;
}

function axisMove(world, pos, r, h, axis, delta, stepHeight) {
  const start = pos[axis];
  pos[axis] = start + delta;
  if (!blockedAt(world, pos, r, h)) return false;

  // Tentative de franchissement de marche.
  const yStart = pos.y;
  pos.y = yStart + stepHeight;
  if (!blockedAt(world, pos, r, h)) {
    // On redescend jusqu'au premier contact pour se poser sur la marche.
    let drop = stepHeight;
    let lo = 0, hi = stepHeight;
    for (let i = 0; i < 6; i++) {           // recherche dichotomique, 6 passes suffisent
      const mid = (lo + hi) * 0.5;
      pos.y = yStart + stepHeight - mid;
      if (blockedAt(world, pos, r, h)) hi = mid; else lo = mid;
    }
    drop = lo;
    pos.y = yStart + stepHeight - drop;
    return false;
  }

  // Échec : on annule le déplacement sur cet axe.
  pos.y = yStart;
  pos[axis] = start;
  return true;
}

function blockedAt(world, pos, r, h) {
  return world.overlaps(pos.x - r, pos.y + EPS, pos.z - r, pos.x + r, pos.y + h - EPS, pos.z + r);
}

/** Intersection rayon / AABB d'un acteur (pour les tirs). */
export function rayActor(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, h, maxT) {
  const b = { minX: cx - r, minY: cy, minZ: cz - r, maxX: cx + r, maxY: cy + h, maxZ: cz + r };
  const hit = rayBox(ox, oy, oz, dx, dy, dz, b, maxT);
  return hit ? hit.t : -1;
}
