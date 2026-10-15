/**
 * bots.js — l'IA adverse.
 *
 * Machine à états volontairement courte (patrouille / traque / combat /
 * repli à couvert), au-dessus d'un pilotage "steering" simple. Pas de A*, pas de
 * navmesh à éditer : les bots se déplacent de point en point sur la grille de
 * navigation générée automatiquement (world.js) et évitent les obstacles avec
 * trois rayons ("moustaches"). C'est suffisant pour des cartes ouvertes et ça
 * coûte presque rien, ce qui compte quand douze bots tournent en même temps.
 *
 * Combat entre bots inclus : la cible est simplement l'ennemi visible le plus
 * menaçant, que ce soit le joueur ou un autre bot.
 */

import * as THREE from '../vendor/three.module.js';
import { BOT, WEAPONS, WEAPON_ORDER } from './config.js';
import { moveActor } from './collision.js';
import { Loadout } from './weapons.js';

const V = () => ({ x: 0, y: 0, z: 0 });

export class Bot {
  constructor(id, name, color, difficulty) {
    this.id = id;
    this.name = name;
    this.isBot = true;
    this.color = color;
    this.diff = difficulty;

    this.pos = V();
    this.vel = V();
    this.yaw = Math.random() * Math.PI * 2;
    this.pitch = 0;
    this.height = BOT.height;
    this.onGround = false;
    this.health = difficulty.health;
    this.maxHealth = difficulty.health;
    this.alive = true;
    this.respawnTimer = 0;
    this.kills = 0; this.deaths = 0; this.score = 0;

    this.loadout = new Loadout(WEAPON_ORDER[(Math.random() * 3) | 0]);
    this.state = 'patrol';
    this.target = null;
    this.lastSeen = V();
    this.hasLastSeen = false;
    this.goal = null;
    this.goalTimer = 0;
    this.senseTimer = Math.random() * 0.2;
    this.reactionTimer = 0;
    this.burstTimer = 0;
    this.burstRest = 0;
    this.burstStarted = false;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = 0;
    this.aimErrX = 0; this.aimErrY = 0;
    this.aimTimer = 0;
    this.stuckTimer = 0;
    this.lastPos = V();
    this.jumpCooldown = 0;

    this._disp = V();
    this._near = [];
    this.mesh = buildBotMesh(color);
    this.mesh.visible = false;
  }

  get radius() { return BOT.radius; }
  get eyeY() { return this.pos.y + this.height - BOT.eyeOffset; }

  spawn(x, y, z, yaw) {
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.yaw = yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.state = 'patrol';
    this.target = null;
    this.hasLastSeen = false;
    this.goal = null;
    this.loadout.reset(WEAPON_ORDER[(Math.random() * 3) | 0]);
    this.mesh.visible = true;
  }

  damage(amount, from) {
    if (!this.alive) return false;
    this.health -= amount;
    // Être touché révèle la position du tireur : le bot réagit au lieu de subir.
    if (from && from.alive) {
      this.target = from;
      this.lastSeen.x = from.pos.x; this.lastSeen.y = from.pos.y; this.lastSeen.z = from.pos.z;
      this.hasLastSeen = true;
      if (this.state === 'patrol') this.state = 'hunt';
    }
    if (this.health <= 0) {
      this.health = 0; this.alive = false;
      this.respawnTimer = BOT.respawnDelay;
      this.mesh.visible = false;
      return true;
    }
    return false;
  }

  heal(a) { this.health = Math.min(this.maxHealth, this.health + a); return true; }

  // ------------------------------------------------------------------ IA ---

  update(dt, game) {
    this.loadout.update(dt);
    if (!this.alive) { this.respawnTimer -= dt; return; }

    const d = this.diff;
    this.senseTimer -= dt;
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.12 + Math.random() * 0.06;   // perception à ~8 Hz, pas à 60
      this.sense(game);
    }
    this.think(dt, game);
    this.aim(dt, game);
    this.shoot(dt, game);
    this.move(dt, game, d);
  }

  /** Choisit la cible : ennemi visible le plus proche (joueur ou bot). */
  sense(game) {
    const d = this.diff;
    const ex = this.pos.x, ey = this.eyeY, ez = this.pos.z;
    let best = null, bestScore = Infinity;

    for (const a of game.actors) {
      if (a === this || !a.alive) continue;
      const dx = a.pos.x - ex, dz = a.pos.z - ez;
      const dist = Math.hypot(dx, dz);
      if (dist > d.viewDist) continue;

      // Cône de vision : on ne voit pas dans son dos.
      const ang = Math.abs(angleDiff(Math.atan2(-dx, -dz), this.yaw));
      const behind = ang > d.fov * 0.5;
      if (behind && dist > 8) continue;   // sauf de très près (on "entend")

      const ty = a.eyeY - 0.25;
      if (game.world.collision.blocked(ex, ey, ez, a.pos.x, ty, a.pos.z)) continue;

      // Le joueur est légèrement prioritaire : il est plus intéressant à affronter.
      let score = dist * (a.isBot ? 1.35 : 1.0);
      if (a === this.target) score *= 0.75;   // hystérésis, évite de changer de cible sans arrêt
      if (score < bestScore) { bestScore = score; best = a; }
    }

    if (best) {
      if (best !== this.target) this.reactionTimer = this.diff.reaction;
      this.target = best;
      this.lastSeen.x = best.pos.x; this.lastSeen.y = best.pos.y; this.lastSeen.z = best.pos.z;
      this.hasLastSeen = true;
      this.visible = true;
    } else {
      this.visible = false;
      if (this.target && !this.target.alive) this.target = null;
    }
  }

  think(dt, game) {
    const d = this.diff;
    this.reactionTimer = Math.max(0, this.reactionTimer - dt);
    this.goalTimer -= dt;

    const lowHealth = this.health < this.maxHealth * 0.35;

    if (this.visible && this.target) {
      if (lowHealth && Math.random() < d.coverChance * dt * 2.2) {
        this.state = 'cover';
        this.goal = this.findCover(game, this.target);
        this.goalTimer = 3.0;
      } else if (this.state !== 'cover') {
        this.state = 'engage';
      }
    } else if (this.state === 'engage') {
      this.state = this.hasLastSeen ? 'hunt' : 'patrol';
      this.goal = this.hasLastSeen ? { x: this.lastSeen.x, y: this.lastSeen.y, z: this.lastSeen.z } : null;
      this.goalTimer = 4.0;
    }

    if (this.state === 'cover' && this.goalTimer <= 0) this.state = 'engage';

    if (this.state === 'patrol' || this.state === 'hunt') {
      if (!this.goal || this.goalTimer <= 0 || dist2D(this.pos, this.goal) < 2.0) {
        this.goal = this.pickRoamGoal(game);
        this.goalTimer = 6.0 + Math.random() * 4;
        if (this.state === 'hunt') this.hasLastSeen = false;
      }
    }
  }

  /** Objectif d'errance : on privilégie les points éloignés pour couvrir la carte. */
  pickRoamGoal(game) {
    const nav = game.world.nav;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 6; i++) {
      const n = nav.random();
      if (!n) break;
      const dist = dist2D(this.pos, n);
      const score = dist > 6 ? dist + Math.random() * 20 : -10;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  /** Point de navigation proche d'où l'ennemi n'est PAS visible. */
  findCover(game, enemy) {
    const nav = game.world.nav;
    const near = nav.near(this.pos.x, this.pos.z, 16, this._near);
    let best = null, bestD = Infinity;
    const ey = enemy.eyeY;
    for (let i = 0; i < near.length; i += 2) {     // un point sur deux : c'est assez
      const n = near[i];
      if (!game.world.collision.blocked(n.x, n.y + 1.3, n.z, enemy.pos.x, ey, enemy.pos.z)) continue;
      const dd = dist2D(this.pos, n);
      if (dd < 3) continue;
      if (dd < bestD) { bestD = dd; best = n; }
    }
    return best || this.pickRoamGoal(game);
  }

  aim(dt, game) {
    const d = this.diff;
    this.aimTimer -= dt;
    if (this.aimTimer <= 0) {
      this.aimTimer = 0.18 + Math.random() * 0.12;
      this.aimErrX = (Math.random() - 0.5) * 2 * d.aimError;
      this.aimErrY = (Math.random() - 0.5) * 2 * d.aimError;
    }

    let tx, ty, tz;
    if (this.target && this.visible) {
      const t = this.target;
      // Anticipation : compense partiellement le temps de réaction.
      const lead = d.leadFactor * d.reaction;
      tx = t.pos.x + (t.vel ? t.vel.x * lead : 0);
      tz = t.pos.z + (t.vel ? t.vel.z * lead : 0);
      ty = t.eyeY - 0.2;
    } else if (this.goal) {
      tx = this.goal.x; ty = this.eyeY; tz = this.goal.z;
    } else return;

    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const dy = ty - this.eyeY;
    const flat = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz) + this.aimErrX;
    const wantPitch = Math.atan2(dy, Math.max(0.01, flat)) + this.aimErrY;

    // Vitesse de visée liée à la difficulté : un bot facile "traîne" visiblement.
    const turn = (this.visible ? 7.5 : 3.5) * (0.55 + d.speedMul * 0.6);
    const k = 1 - Math.exp(-turn * dt);
    this.yaw += angleDiff(wantYaw, this.yaw) * k;
    this.pitch += (wantPitch - this.pitch) * k;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
    this.aimYawWanted = wantYaw;
  }

  shoot(dt, game) {
    const w = this.loadout.current;
    const def = w.def;
    this.burstTimer -= dt;
    this.burstRest -= dt;

    if (w.isEmpty && !w.isReloading) { w.startReload(); return; }
    if (!this.target || !this.visible || this.reactionTimer > 0 || w.isReloading) return;

    const dist = dist2D(this.pos, this.target.pos);
    if (dist > def.range * 0.95) return;
    // Le fusil à pompe ne tire pas à 40 m : chaque bot joue son arme.
    if (def.id === 'broyeur' && dist > 16) return;

    // Aligné ? On tolère un petit écart, sinon les bots ne tireraient jamais.
    const off = Math.abs(angleDiff(this.aimYawWanted - this.aimErrX, this.yaw));
    if (off > 0.11) return;

    // Rafales : on tire pendant `burstTimer` secondes, puis on souffle.
    // Sans cela un bot "difficile" maintiendrait la gâchette en permanence.
    if (this.burstRest > 0) return;
    if (this.burstTimer <= 0) {
      if (this.burstStarted) {
        this.burstStarted = false;
        this.burstRest = 0.35 + Math.random() * 0.5;
        return;
      }
      this.burstTimer = this.diff.burstMin + Math.random() * (this.diff.burstMax - this.diff.burstMin);
      this.burstStarted = true;
    }

    if (w.cooldown > 0) return;
    if (w.tryFire(false)) {
      w.cooldown = w.interval / Math.max(0.2, this.diff.fireRateMul);
      game.fireShot(this, w, this.diff.damageMul);
    }
  }

  move(dt, game, d) {
    const world = game.world;
    this.jumpCooldown -= dt;
    let wx = 0, wz = 0;

    if (this.state === 'engage' && this.target) {
      // On garde une distance adaptée à l'arme, en se déplaçant latéralement.
      const def = this.loadout.current.def;
      const ideal = def.id === 'broyeur' ? 6 : (def.id === 'lynx' ? 26 : 14);
      const dx = this.target.pos.x - this.pos.x, dz = this.target.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const fx = dx / dist, fz = dz / dist;
      const approach = dist > ideal + 3 ? 1 : (dist < ideal - 3 ? -1 : 0);
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafeTimer = 0.8 + Math.random() * 1.2; this.strafeDir *= -1; }
      const sx = -fz * this.strafeDir, sz = fx * this.strafeDir;
      wx = fx * approach + sx * d.strafe;
      wz = fz * approach + sz * d.strafe;
    } else if (this.goal) {
      const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      wx = dx / dist; wz = dz / dist;
    }

    const len = Math.hypot(wx, wz);
    if (len > 0.001) {
      wx /= len; wz /= len;
      // Évitement : trois rayons courts devant, on glisse le long de l'obstacle.
      const steer = this.avoid(world, wx, wz);
      wx = steer.x; wz = steer.z;
    }

    const speed = 6.4 * d.speedMul;
    this.vel.x += wx * BOT.accel * dt;
    this.vel.z += wz * BOT.accel * dt;
    if (len < 0.001 && this.onGround) {
      const f = Math.max(0, 1 - BOT.friction * dt);
      this.vel.x *= f; this.vel.z *= f;
    }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > speed) { const k = speed / hs; this.vel.x *= k; this.vel.z *= k; }

    this.vel.y -= BOT.gravity * dt;
    if (this.vel.y < -45) this.vel.y = -45;

    const disp = this._disp;
    disp.x = this.vel.x * dt; disp.y = this.vel.y * dt; disp.z = this.vel.z * dt;
    const res = moveActor(world.collision, this.pos, BOT.radius, this.height, disp, BOT.stepHeight);
    this.onGround = res.onGround;
    if (res.onGround && this.vel.y < 0) this.vel.y = 0;
    if (res.hitCeiling && this.vel.y > 0) this.vel.y = 0;

    // Anti-blocage : si on n'avance plus alors qu'on veut avancer, on saute
    // puis on change d'objectif. Simple, et ça suffit à débloquer 99 % des cas.
    const moved = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z);
    this.lastPos.x = this.pos.x; this.lastPos.z = this.pos.z;
    if (len > 0.1 && moved < 0.012) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.45 && this.onGround && this.jumpCooldown <= 0) {
        this.vel.y = BOT.jumpSpeed; this.jumpCooldown = 1.2;
      }
      if (this.stuckTimer > 1.4) {
        this.goal = this.pickRoamGoal(game);
        this.goalTimer = 5; this.stuckTimer = 0;
        this.strafeDir *= -1;
      }
    } else this.stuckTimer = Math.max(0, this.stuckTimer - dt);

    if (this.pos.y < -30) { this.health = 0; this.alive = false; this.respawnTimer = BOT.respawnDelay; this.mesh.visible = false; }
  }

  /** Trois rayons courts : devant, et à ±35°. Renvoie une direction corrigée. */
  avoid(world, wx, wz) {
    const probe = 2.2;
    const ex = this.pos.x, ey = this.pos.y + 0.9, ez = this.pos.z;
    const c = world.collision;
    const fwd = c.raycast(ex, ey, ez, wx, 0, wz, probe);
    if (!fwd) return { x: wx, z: wz };
    const a = 0.61;
    const cs = Math.cos(a), sn = Math.sin(a);
    const lx = wx * cs - wz * sn, lz = wx * sn + wz * cs;
    const rx = wx * cs + wz * sn, rz = -wx * sn + wz * cs;
    const hl = c.raycast(ex, ey, ez, lx, 0, lz, probe);
    const hr = c.raycast(ex, ey, ez, rx, 0, rz, probe);
    if (!hl && hr) return { x: lx, z: lz };
    if (!hr && hl) return { x: rx, z: rz };
    if (!hl && !hr) return this.strafeDir > 0 ? { x: rx, z: rz } : { x: lx, z: lz };
    // Les deux côtés sont bouchés : on longe le mur touché.
    const nx = fwd.nx, nz = fwd.nz;
    const tx = -nz, tz = nx;
    const s = (wx * tx + wz * tz) >= 0 ? 1 : -1;
    return { x: tx * s, z: tz * s };
  }

  syncMesh() {
    if (!this.alive) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.rotation.y = this.yaw;
    // Signe aligné sur la convention de tir : fireShot envoie la balle vers
    // by = sin(pitch), donc un tangage positif vise vers le haut. Le bras
    // portait l'opposé, et montrait le sol quand le bot visait un toit.
    if (this.mesh.userData.arm) this.mesh.userData.arm.rotation.x = this.pitch;
  }
}

// ------------------------------------------------------------- modèle 3D ---

/**
 * Silhouette "low-poly" originale : un tronc anguleux, une tête cubique
 * inclinée, deux jambes, un bras porte-arme. Six boîtes au total.
 */
/**
 * Fusionne une liste de boîtes en une seule `BufferGeometry` à couleur par
 * sommet — le même procédé que `world.js` applique au décor, pour la même
 * raison : un maillage, un draw call.
 *
 * La couleur passe par les sommets et non par le matériau, puisque c'est elle
 * qui empêchait la fusion : trois teintes sur un bot, donc trois matériaux,
 * donc trois dessins. `ry` est appliqué avant la translation, pour les pièces
 * posées de biais.
 */
function fusionneBoites(boites) {
  const geos = boites.map((b) => {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    if (b.ry) g.rotateY(b.ry);
    g.translate(b.x, b.y, b.z);
    return { g, color: b.color };
  });

  let nv = 0, ni = 0;
  for (const { g } of geos) { nv += g.attributes.position.count; ni += g.index.count; }

  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const idx = new Uint16Array(ni);          // 9 boîtes = 216 sommets, large
  const c = new THREE.Color();

  let vo = 0, io = 0;
  for (const { g, color } of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    c.setHex(color);
    for (let i = 0; i < n; i++) {
      const o = (vo + i) * 3;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
    }
    const I = g.index.array;
    for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + vo;
    vo += n; io += I.length;
    g.dispose();                            // la géométrie source ne sert plus
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

const BOT_DARK = 0x2a2f38;      // bassin et jambes
const BOT_VISOR = 0x12161c;     // visière
const BOT_GUN = 0x2b3038;       // corps de l'arme

/**
 * Un bot en DEUX maillages au lieu de neuf : le corps, et le bras qui pivote.
 *
 * Le bras reste séparé parce qu'il tourne avec le tangage, et que c'est ce qui
 * permet de lire de loin où un bot vise. Le fondre dans le corps rendrait un
 * troisième draw call sur huit bots, au prix de cette lecture : l'échange n'en
 * vaut pas la peine.
 *
 * Un seul matériau par bot, partagé par les deux maillages. `game.js` libère
 * les deux par sa traversée de scène, donc rien à défaire ici.
 */
function buildBotMesh(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });

  const corps = new THREE.Mesh(fusionneBoites([
    { w: 0.62, h: 0.72, d: 0.36, x: 0, y: 1.02, z: 0, color },                    // torse
    { w: 0.50, h: 0.22, d: 0.32, x: 0, y: 0.66, z: 0, color: BOT_DARK },          // bassin
    { w: 0.20, h: 0.62, d: 0.24, x: -0.15, y: 0.31, z: 0, color: BOT_DARK },      // jambe g.
    { w: 0.20, h: 0.62, d: 0.24, x: 0.15, y: 0.31, z: 0, color: BOT_DARK },       // jambe d.
    { w: 0.38, h: 0.34, d: 0.36, x: 0, y: 1.56, z: 0, ry: 0.18, color },          // tête
    { w: 0.30, h: 0.10, d: 0.06, x: 0, y: 1.58, z: -0.19, color: BOT_VISOR },     // visière
  ]), mat);
  g.add(corps);

  // Bras + arme, dans le repère du pivot : les décalages de l'ancien groupe
  // d'arme (0, -0.02, -0.3) sont reportés dans les positions ci-dessous.
  const arm = new THREE.Group();
  arm.position.set(0.3, 1.18, 0);
  arm.add(new THREE.Mesh(fusionneBoites([
    { w: 0.16, h: 0.16, d: 0.42, x: 0, y: 0, z: -0.16, color },                   // bras
    { w: 0.09, h: 0.10, d: 0.55, x: 0, y: -0.02, z: -0.50, color: BOT_GUN },      // arme
    { w: 0.06, h: 0.06, d: 0.14, x: 0, y: 0.04, z: -0.35, color },                // bouche
  ]), mat));
  g.add(arm);
  g.userData.arm = arm;

  g.matrixAutoUpdate = true;
  return g;
}

function dist2D(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export { WEAPONS };
