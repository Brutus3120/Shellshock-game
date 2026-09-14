/**
 * player.js — le joueur à la première personne.
 *
 * Déplacement de type "arcade" : accélération forte, friction franche,
 * contrôle aérien réduit. Marcher / courir / sauter / s'accroupir, avec
 * franchissement automatique des marches et refus de se relever sous un plafond.
 */

import { PLAYER } from './config.js';
import { moveActor } from './collision.js';
import { Loadout } from './weapons.js';
import { KEY } from './input.js';

export class Player {
  constructor(name = 'Vous') {
    this.name = name;
    this.isBot = false;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.height = PLAYER.heightStand;
    this.crouching = false;
    this.onGround = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.health = PLAYER.maxHealth;
    this.alive = true;
    this.respawnTimer = 0;
    this.loadout = new Loadout();
    this.kills = 0; this.deaths = 0; this.score = 0;
    this.bobTime = 0;
    this.ads = 0;
    this.lastDamageFrom = null;
    this.color = 0x6fd3ff;
    this.speed2D = 0;
    this._disp = { x: 0, y: 0, z: 0 };
  }

  get radius() { return PLAYER.radius; }
  get eyeY() { return this.pos.y + this.height - PLAYER.eyeOffset; }
  get viewPitch() { return clamp(this.pitch + this.recoilPitch, -1.5, 1.5); }
  get viewYaw() { return this.yaw + this.recoilYaw; }

  direction(out) {
    const cp = Math.cos(this.viewPitch), sp = Math.sin(this.viewPitch);
    const cy = Math.cos(this.viewYaw), sy = Math.sin(this.viewYaw);
    out.x = -sy * cp; out.y = sp; out.z = -cy * cp;
    return out;
  }

  addRecoil(pitch, yaw) {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
  }

  spawn(x, y, z, yaw) {
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.yaw = yaw; this.pitch = 0;
    this.recoilPitch = this.recoilYaw = 0;
    this.health = PLAYER.maxHealth;
    this.alive = true;
    this.crouching = false;
    this.height = PLAYER.heightStand;
    this.loadout.reset(this.loadout.currentId);
  }

  damage(amount, from) {
    if (!this.alive) return false;
    this.health -= amount;
    this.lastDamageFrom = from;
    if (this.health <= 0) { this.health = 0; this.alive = false; this.respawnTimer = PLAYER.respawnDelay; return true; }
    return false;
  }

  heal(amount) {
    if (this.health >= PLAYER.maxHealth) return false;
    this.health = Math.min(PLAYER.maxHealth, this.health + amount);
    return true;
  }

  /** Regard souris. Séparé de update() pour rester fluide même à framerate bas. */
  look(dx, dy, sensitivity, invertY, fovScale) {
    const s = 0.0022 * sensitivity * fovScale;
    this.yaw -= dx * s;
    this.pitch += (invertY ? dy : -dy) * s;
    this.pitch = clamp(this.pitch, -1.52, 1.52);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  update(dt, input, world, allowControl) {
    // Récupération du recul : rapide au début, douce ensuite.
    const rec = Math.exp(-9 * dt);
    this.recoilPitch *= rec;
    this.recoilYaw *= rec;

    if (!this.alive) { this.respawnTimer -= dt; return; }

    const wantCrouch = allowControl && input.down(...KEY.crouch);
    const wantRun = allowControl && input.down(...KEY.run);

    // Accroupissement : on ne se relève pas si un plafond gêne.
    const targetH = wantCrouch ? PLAYER.heightCrouch : PLAYER.heightStand;
    if (targetH > this.height) {
      const r = PLAYER.radius;
      const free = !world.collision.overlaps(
        this.pos.x - r, this.pos.y + this.height, this.pos.z - r,
        this.pos.x + r, this.pos.y + targetH, this.pos.z + r);
      if (free) this.height = Math.min(targetH, this.height + 6 * dt);
    } else if (targetH < this.height) {
      this.height = Math.max(targetH, this.height - 8 * dt);
    }
    this.crouching = this.height < PLAYER.heightStand - 0.05;

    // Direction souhaitée, dans le repère du joueur.
    let fx = 0, fz = 0;
    if (allowControl) {
      const f = (input.down(...KEY.forward) ? 1 : 0) - (input.down(...KEY.back) ? 1 : 0);
      const s = (input.down(...KEY.right) ? 1 : 0) - (input.down(...KEY.left) ? 1 : 0);
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      fx = (-sy * f) + (cy * s);
      fz = (-cy * f) + (-sy * s);
      const len = Math.hypot(fx, fz);
      if (len > 0) { fx /= len; fz /= len; }
    }

    let maxSpeed = PLAYER.speedWalk;
    if (this.crouching) maxSpeed = PLAYER.speedCrouch;
    else if (wantRun && fz * fz + fx * fx > 0) maxSpeed = PLAYER.speedRun;
    if (this.ads > 0.5) maxSpeed *= 0.55;

    const accel = this.onGround ? PLAYER.accelGround : PLAYER.accelAir * PLAYER.speedAir;
    this.vel.x += fx * accel * dt;
    this.vel.z += fz * accel * dt;

    // Friction au sol uniquement : la glisse en l'air fait partie du ressenti arcade.
    if (this.onGround) {
      const f = Math.max(0, 1 - PLAYER.frictionGround * dt);
      if (fx === 0 && fz === 0) { this.vel.x *= f; this.vel.z *= f; }
    }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > maxSpeed) {
      const k = maxSpeed / hs;
      // En l'air on ne bride pas brutalement : on laisse la vitesse retomber.
      const limit = this.onGround ? k : Math.max(k, 0.995);
      this.vel.x *= limit; this.vel.z *= limit;
    }
    this.speed2D = Math.hypot(this.vel.x, this.vel.z);

    // Saut, avec tolérance avant/après le bord ("coyote time" + tampon).
    this.coyote = this.onGround ? PLAYER.coyoteTime : Math.max(0, this.coyote - dt);
    if (allowControl && input.hit(...KEY.jump)) this.jumpBuffer = PLAYER.jumpBuffer;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vel.y = PLAYER.jumpSpeed;
      this.coyote = 0; this.jumpBuffer = 0; this.onGround = false;
    }

    this.vel.y -= PLAYER.gravity * dt;
    if (this.vel.y < -45) this.vel.y = -45;

    const d = this._disp;
    d.x = this.vel.x * dt; d.y = this.vel.y * dt; d.z = this.vel.z * dt;
    const res = moveActor(world.collision, this.pos, PLAYER.radius, this.height, d, PLAYER.stepHeight);
    this.onGround = res.onGround;
    if (res.onGround && this.vel.y < 0) this.vel.y = 0;
    if (res.hitCeiling && this.vel.y > 0) this.vel.y = 0;

    // Filet de sécurité : si le joueur sort du monde, on le fait réapparaître.
    if (this.pos.y < -30) { this.health = 0; this.alive = false; this.respawnTimer = PLAYER.respawnDelay; }

    if (this.onGround) this.bobTime += this.speed2D * dt;
    this.loadout.update(dt);
  }
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
