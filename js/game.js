/**
 * game.js — le cœur du jeu : scène, boucle de simulation, combat, score.
 *
 * Un seul fichier pour la partie en cours, parce que tout y est fortement lié :
 * les tirs ont besoin des acteurs, les acteurs du monde, le score des tirs.
 * Les morceaux réutilisables (collision, armes, IA, ATH) vivent ailleurs.
 */

import * as THREE from '../vendor/three.module.js';
import { PLAYER, BOT_NAMES, BOT_COLORS, DIFFICULTIES, QUALITY, PICKUP, TICK_MAX, WEAPON_ORDER } from './config.js';
import { buildMapData } from './maps.js';
import { buildWorld, setupLights } from './world.js';
import { Player } from './player.js';
import { Bot } from './bots.js';
import { Effects } from './effects.js';
import { createViewModel } from './weapons.js';
import { rayActor } from './collision.js';
import { Input, KEY } from './input.js';
import * as Sfx from './audio.js';

const TMP = { x: 0, y: 0, z: 0 };
const MUZZLE = { x: 0, y: 0, z: 0 };   // sortie réutilisée de muzzlePosition
const DIR = { x: 0, y: 0, z: 0 };      // direction non dispersée, pour le flash

export class Game {
  constructor(canvas, opts, settings, hud) {
    this.canvas = canvas;
    this.opts = opts;
    this.settings = settings;
    this.hud = hud;
    this.quality = QUALITY[settings.quality] || QUALITY.moyen;

    this.paused = false;
    this.over = false;
    this.started = false;
    this.duration = opts.duration;
    this.timeLeft = opts.duration > 0 ? opts.duration : Infinity;
    this.scoreLimit = opts.scoreLimit;
    this.onEnd = null;
    this.onPauseRequest = null;

    this.difficulty = DIFFICULTIES[opts.difficulty] || DIFFICULTIES.normal;

    this._setupRenderer();
    this._setupWorld();
    this._setupActors();
    this._setupPickups();
    this._setupViewModel();

    this.input = new Input(canvas);
    this.effects = new Effects(this.scene, this.quality);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this.showScoreboard = false;
    this.accumulator = 0;
    this.cameraShake = 0;
  }

  // ------------------------------------------------------------- config ---

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,           // coûteux pour un rendu à facettes : inutile ici
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = false;
    // Courbe filmique : les hautes lumières roulent au lieu de brûler, et les
    // teintes saturées cessent de virer en s'éclairant. L'exposition, elle, est
    // posée par carte dans _setupWorld — mapData n'existe pas encore ici.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    if (this.quality.shadows) this.renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  _setupWorld() {
    this.mapData = buildMapData(this.opts.map);
    this.renderer.toneMappingExposure = this.mapData.exposure ?? 1;
    this.world = buildWorld(this.mapData, this.quality);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.mapData.sky);
    // Le brouillard commence tard : il sert à masquer la coupure lointaine,
    // pas à assombrir le combat rapproché.
    this.scene.fog = new THREE.Fog(this.mapData.fog, this.quality.fogFar * 0.45, this.quality.fogFar);
    this.scene.add(this.world.mesh);
    if (this.quality.shadows) { this.world.mesh.receiveShadow = true; this.world.mesh.castShadow = true; }
    this.lights = setupLights(this.scene, this.mapData, this.quality.shadows);

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.08, this.quality.fogFar + 40);
  }

  _setupActors() {
    this.player = new Player('Vous');
    this.player.loadout.reset(this.opts.weapon);
    this.bots = [];
    const names = shuffle(BOT_NAMES.slice());
    for (let i = 0; i < this.opts.botCount; i++) {
      const b = new Bot(i, names[i % names.length], BOT_COLORS[i % BOT_COLORS.length], this.difficulty);
      if (this.quality.shadows) b.mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(b.mesh);
      this.bots.push(b);
    }
    this.actors = [this.player, ...this.bots];
    for (const a of this.actors) this.respawnActor(a, true);
  }

  _setupPickups() {
    this.pickups = [];
    const healthGeo = new THREE.OctahedronGeometry(0.34);
    const ammoGeo = new THREE.BoxGeometry(0.46, 0.3, 0.3);
    const healthMat = new THREE.MeshLambertMaterial({ color: 0x7ddf64, emissive: 0x1c4a14 });
    const ammoMat = new THREE.MeshLambertMaterial({ color: 0xffb347, emissive: 0x4a3410 });
    for (const p of this.mapData.pickups) {
      const y = this.groundAt(p.x, p.z) + 0.7;
      const mesh = new THREE.Mesh(p.type === 'health' ? healthGeo : ammoGeo,
                                  p.type === 'health' ? healthMat : ammoMat);
      mesh.position.set(p.x, y, p.z);
      this.scene.add(mesh);
      this.pickups.push({ type: p.type, x: p.x, y, z: p.z, mesh, cooldown: 0 });
    }
  }

  /**
   * L'arme du joueur est rendue par une SECONDE caméra, dans une scène à part.
   * C'est la façon la plus simple d'éviter qu'elle traverse les murs, sans
   * recourir à un second passage de profondeur coûteux.
   */
  _setupViewModel() {
    this.vmScene = new THREE.Scene();
    // Champ de vision fixe et plus étroit que celui du monde : l'arme garde la
    // même taille quel que soit le FOV choisi par le joueur, et ne se déforme pas.
    this.vmCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 5);
    this.vmScene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const l = new THREE.DirectionalLight(0xffffff, 2.4);
    l.position.set(1, 2, 1);
    this.vmScene.add(l);
    this.viewModels = {};
    for (const id of WEAPON_ORDER) {
      const m = createViewModel(id);
      m.scale.setScalar(0.88);
      m.visible = false;
      this.vmScene.add(m);
      this.viewModels[id] = m;
    }
    this.vmRecoil = 0;
    this.vmFlash = 0;        // secondes restantes d'allumage du flash de bouche
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * this.quality.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }

  // --------------------------------------------------------- réapparition ---

  /**
   * Hauteur où un acteur tient debout en (x, z), ou null si l'endroit est inutilisable.
   *
   * Le test de recouvrement n'est pas une précaution de principe : quand la sonde de
   * sol démarre à l'intérieur d'un solide — un point de réapparition posé sur une
   * cloison traversante, par exemple — `rayBox` renvoie une distance nulle et
   * `groundHeight` rend la hauteur de sonde elle-même. L'acteur apparaîtrait alors en
   * haut du mur, puis sur le toit, puis dans le vide. C'est exactement le contrôle que
   * `buildNav` applique déjà à ses nœuds.
   */
  standingY(x, z) {
    const y = this.groundAt(x, z);
    if (y < -0.5 || y > 20) return null;
    const r = PLAYER.radius + 0.05;
    if (this.world.collision.overlaps(x - r, y + 0.1, z - r, x + r, y + PLAYER.heightStand, z + r)) return null;
    return y;
  }

  /** Choisit le point de réapparition praticable le plus loin des ennemis vivants. */
  respawnActor(actor, initial = false) {
    const spawns = this.mapData.spawns;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < spawns.length; i++) {
      const [x, z] = spawns[i];
      const y = this.standingY(x, z);
      if (y === null) continue;
      let minDist = Infinity;
      for (const a of this.actors || []) {
        if (a === actor || !a.alive) continue;
        minDist = Math.min(minDist, Math.hypot(a.pos.x - x, a.pos.z - z));
      }
      const score = (minDist === Infinity ? 100 : minDist) + Math.random() * 6;
      if (score > bestScore) { bestScore = score; best = [x, y, z]; }
    }
    // Aucun point utilisable : le graphe de navigation n'en propose que des valides.
    if (!best) {
      const n = this.world.nav.random();
      best = n ? [n.x, n.y, n.z] : [0, this.groundAt(0, 0), 0];
    }
    const [x, y, z] = best;
    const yaw = Math.atan2(x, z);             // orienté vers le centre de la carte
    actor.spawn(x, y + 0.05, z, yaw);
    if (initial && actor === this.player) this.player.loadout.reset(this.opts.weapon);
  }

  /** Hauteur du sol, sondée sous le plafond éventuel de la carte. */
  groundAt(x, z) {
    return this.world.collision.groundHeight(x, z, this.mapData.sampleY || 40);
  }

  // ----------------------------------------------------------- le combat ---

  /**
   * Résout un tir "hitscan" : un rayon par plomb, mur d'abord, acteurs ensuite.
   * Aucun projectile simulé — c'est instantané, exact et quasi gratuit.
   */
  fireShot(shooter, weapon, damageMul = 1) {
    const def = weapon.def;
    const isPlayer = shooter === this.player;

    // Origine du tir : les yeux. (Le canon visible n'est qu'un décor.)
    const ox = shooter.pos.x, oy = shooter.eyeY, oz = shooter.pos.z;
    const yaw = isPlayer ? shooter.viewYaw : shooter.yaw;
    const pitch = isPlayer ? shooter.viewPitch : shooter.pitch;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const bx = -Math.sin(yaw) * cp, by = sp, bz = -Math.cos(yaw) * cp;

    let spread;
    if (isPlayer) {
      const aim = shooter.ads;
      spread = def.spreadHip * (1 - aim) + def.spreadAds * aim;
      spread += def.spreadMove * Math.min(1, shooter.speed2D / 8) * (shooter.onGround ? 1 : 1.8);
      if (shooter.crouching) spread *= 0.7;
    } else {
      spread = def.spreadHip * 0.8;
    }

    Sfx.sfxShot(def.id, isPlayer ? 0 : dist3(shooter.pos, this.player.pos));

    let anyHit = false, anyKill = false;
    for (let p = 0; p < def.pellets; p++) {
      const d = jitter(bx, by, bz, spread);
      const hit = this.traceShot(shooter, ox, oy, oz, d.x, d.y, d.z, def, damageMul);
      if (hit.hitActor) { anyHit = true; if (hit.killed) anyKill = true; }
      // Traçante : une seule pour les armes à plombs, sinon l'écran sature.
      if (this.quality.tracers && (p === 0 || def.pellets <= 3)) {
        const muzzle = this.muzzlePosition(shooter, isPlayer, d);
        this.effects.addTracer(muzzle.x, muzzle.y, muzzle.z,
          ox + d.x * hit.dist, oy + d.y * hit.dist, oz + d.z * hit.dist, def.color);
      }
    }

    // Flash de bouche : UN par coup, donc hors de la boucle sur les plombs,
    // sinon le Broyeur-12 en allumerait neuf d'un coup.
    if (isPlayer) {
      this.vmFlash = def.muzzle.life;
    } else {
      DIR.x = bx; DIR.y = by; DIR.z = bz;
      const m = this.muzzlePosition(shooter, false, DIR);
      const c = this.camera.position;
      this.effects.addMuzzle(m.x, m.y, m.z, c.x, c.y, c.z, def.muzzle);
    }

    if (isPlayer) {
      const kick = def.recoil * (shooter.ads > 0.5 ? 0.65 : 1) * (shooter.crouching ? 0.8 : 1);
      shooter.addRecoil(kick * 0.012, (Math.random() - 0.5) * kick * 0.006);
      this.vmRecoil = Math.min(1, this.vmRecoil + 0.35 + def.recoil * 0.12);
      this.cameraShake = Math.min(0.05, this.cameraShake + def.recoil * 0.006);
      if (anyHit) { this.hud.hitMarker(anyKill); Sfx.sfxHit(); }
    }
  }

  /**
   * Point d'où part visuellement le coup. Écrit dans un objet réutilisé : la
   * valeur est consommée tout de suite par l'appelant, et un tir de fusil à
   * pompe appelle cette fonction dix fois.
   */
  muzzlePosition(shooter, isPlayer, d) {
    const m = MUZZLE;
    if (isPlayer) {
      // Légèrement décalé pour que la traçante semble sortir de l'arme tenue.
      const rx = -Math.cos(shooter.viewYaw), rz = Math.sin(shooter.viewYaw);
      m.x = shooter.pos.x + rx * 0.22 + d.x * 0.6;
      m.y = shooter.eyeY - 0.14 + d.y * 0.6;
      m.z = shooter.pos.z + rz * 0.22 + d.z * 0.6;
    } else {
      // Le bot porte son arme sur le bras droit, à 1,18 m et 0,30 m sur le côté
      // (voir buildBotMesh). Partir des yeux ferait sortir le coup du visage —
      // invisible avec une traçante fine, flagrant avec un flash de bouche.
      const rx = Math.cos(shooter.yaw), rz = -Math.sin(shooter.yaw);
      m.x = shooter.pos.x + rx * 0.30 + d.x * 0.62;
      m.y = shooter.pos.y + 1.18 + d.y * 0.62;
      m.z = shooter.pos.z + rz * 0.30 + d.z * 0.62;
    }
    return m;
  }

  traceShot(shooter, ox, oy, oz, dx, dy, dz, def, damageMul) {
    const maxD = def.range;
    const wall = this.world.collision.raycast(ox, oy, oz, dx, dy, dz, maxD);
    let bestT = wall ? wall.dist : maxD;
    let victim = null;

    for (const a of this.actors) {
      if (a === shooter || !a.alive) continue;
      const t = rayActor(ox, oy, oz, dx, dy, dz, a.pos.x, a.pos.y, a.pos.z, a.radius + 0.06, a.height, bestT);
      if (t >= 0 && t < bestT) { bestT = t; victim = a; }
    }

    if (victim) {
      const hy = oy + dy * bestT;
      const head = hy > victim.pos.y + victim.height - 0.38;
      const falloff = bestT <= def.falloffStart ? 1
        : Math.max(def.falloffMin, 1 - (bestT - def.falloffStart) / (def.range - def.falloffStart) * (1 - def.falloffMin));
      const dmg = def.damage * falloff * (head ? def.headMul : 1) * damageMul;
      const killed = victim.damage(dmg, shooter);

      this.effects.addImpact(ox + dx * bestT, hy, oz + dz * bestT, -dx, -dy, -dz, victim.color || 0xff6b6b, 4);
      if (victim === this.player) { this.hud.damageFlash(); Sfx.sfxImpact(0); }
      if (shooter === this.player && head && !killed) Sfx.sfxHeadshot();
      if (killed) this.registerKill(shooter, victim, def);
      return { dist: bestT, hitActor: true, killed };
    }

    if (wall) {
      this.effects.addImpact(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT, wall.nx, wall.ny, wall.nz, 0xffe0a8, 6);
      if (shooter !== this.player && dist3({ x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT }, this.player.pos) < 6) {
        Sfx.sfxImpact(3);
      }
    }
    return { dist: bestT, hitActor: false, killed: false };
  }

  registerKill(killer, victim, def) {
    victim.deaths++;
    if (killer && killer !== victim) { killer.kills++; killer.score += 100; }
    this.hud.killFeed(killer ? killer.name : '—', victim.name, def.name,
      killer === this.player, victim === this.player);
    if (killer === this.player) Sfx.sfxKill();
    if (victim === this.player) Sfx.sfxDeath();
    if (this.scoreLimit > 0 && killer && killer.kills >= this.scoreLimit) this.endMatch('score');
  }

  // ------------------------------------------------------------- boucle ---

  start() {
    this.started = true;
    this.hud.show(true);
    this.hud.setOptions(this.settings);
  }

  update(rawDt) {
    const dt = Math.min(rawDt, TICK_MAX);
    const input = this.input;

    if (input.hit(...KEY.pause)) {
      if (this.onPauseRequest) this.onPauseRequest();
      input.endFrame();
      return;
    }

    const active = !this.paused && !this.over && input.locked;

    // Regard : appliqué même si la simulation est en pause interne, pour la fluidité.
    if (active && this.player.alive) {
      const fovScale = this.camera.fov / this.settings.fov;
      this.player.look(input.mouseDX, input.mouseDY, this.settings.sensitivity, this.settings.invertY, fovScale);
    }

    if (active) {
      this.handlePlayerActions(dt);
      this.player.update(dt, input, this.world, this.player.alive);

      for (const b of this.bots) {
        b.update(dt, this);
        if (!b.alive && b.respawnTimer <= 0) this.respawnActor(b);
        b.syncMesh();
      }
      if (!this.player.alive && this.player.respawnTimer <= 0) this.respawnActor(this.player);

      this.updatePickups(dt);
      this.effects.update(dt);

      if (this.duration > 0) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.endMatch('temps'); }
      }
    }

    // Classement affiché (Tab)
    const sb = input.down(...KEY.scoreboard);
    if (sb !== this.showScoreboard) { this.showScoreboard = sb; this.hud.scoreboard(sb, this); }
    else if (sb) this.hud.scoreboard(true, this);

    this.updateCamera(dt);
    this.hud.update(rawDt, this);
    input.endFrame();
  }

  handlePlayerActions(dt) {
    const input = this.input;
    const p = this.player;
    if (!p.alive) return;

    // Visée (clic droit)
    const wantAds = input.buttons[2];
    const adsSpeed = 9;
    p.ads += ((wantAds ? 1 : 0) - p.ads) * Math.min(1, adsSpeed * dt);

    // Changement d'arme
    let switched = false;
    if (input.hit(...KEY.w1)) switched = p.loadout.select(0);
    else if (input.hit(...KEY.w2)) switched = p.loadout.select(1);
    else if (input.hit(...KEY.w3)) switched = p.loadout.select(2);
    else if (input.wheel !== 0) switched = p.loadout.cycle(input.wheel > 0 ? 1 : -1);
    // Changer d'arme coupe le flash en cours : sans ça, la nouvelle arme
    // s'allumerait pour un coup qu'elle n'a pas tiré.
    if (switched) { this.vmFlash = 0; Sfx.sfxSwitch(); this.updateViewModel(); }

    const w = p.loadout.current;
    if (input.hit(...KEY.reload) && w.startReload()) Sfx.sfxReload();

    // Tir. Les armes automatiques tirent tant que le bouton est tenu,
    // les autres exigent un clic par coup.
    const held = input.buttons[0];
    const clicked = input.clicked[0];
    if (held) {
      if (w.ammo <= 0 && !w.isReloading) {
        if (clicked) { Sfx.sfxEmpty(); w.startReload(); }
      } else if (w.def.auto || clicked) {
        if (w.tryFire(false)) this.fireShot(p, w, 1);
      }
    }
  }

  updateViewModel() {
    for (const id of WEAPON_ORDER) this.viewModels[id].visible = (id === this.player.loadout.currentId);
  }

  updatePickups(dt) {
    const p = this.player;
    for (const pk of this.pickups) {
      if (pk.cooldown > 0) {
        pk.cooldown -= dt;
        if (pk.cooldown <= 0) pk.mesh.visible = true;
        continue;
      }
      pk.mesh.rotation.y += dt * 1.6;
      pk.mesh.position.y = pk.y + Math.sin(performance.now() * 0.002 + pk.x) * 0.12;

      for (const a of this.actors) {
        if (!a.alive) continue;
        if (Math.abs(a.pos.x - pk.x) > 1.3 || Math.abs(a.pos.z - pk.z) > 1.3) continue;
        if (Math.abs(a.pos.y + a.height * 0.5 - pk.y) > 1.9) continue;
        let taken = false;
        if (pk.type === 'health') taken = a.health < (a.maxHealth || PLAYER.maxHealth) && a.heal(PICKUP.healthAmount);
        else { a.loadout.refillAll(); taken = true; }
        if (taken) {
          pk.cooldown = PICKUP.respawnTime;
          pk.mesh.visible = false;
          if (a === p) Sfx.sfxPickup();
          break;
        }
      }
      void p;
    }
  }

  updateCamera(dt) {
    const p = this.player;

    // Champ de vision : se resserre en visée, avec une transition douce.
    const def = p.loadout.current.def;
    const targetFov = this.settings.fov * (1 - p.ads * (1 - def.adsFovMul));
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 14 * dt);
      this.camera.updateProjectionMatrix();
    }

    // Balancement de marche : discret, uniquement au sol.
    const bobAmp = p.onGround ? Math.min(1, p.speed2D / PLAYER.speedRun) : 0;
    const bobX = Math.cos(p.bobTime * 1.9) * 0.035 * bobAmp * (1 - p.ads * 0.8);
    const bobY = Math.abs(Math.sin(p.bobTime * 3.8)) * 0.03 * bobAmp * (1 - p.ads * 0.8);

    this.cameraShake *= Math.exp(-9 * dt);
    const sx = (Math.random() - 0.5) * this.cameraShake;
    const sy = (Math.random() - 0.5) * this.cameraShake;

    this.camera.position.set(p.pos.x + bobX, p.eyeY + bobY, p.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = p.viewYaw + sx;
    this.camera.rotation.x = p.viewPitch + sy;
    this.camera.rotation.z = bobX * 0.6;

    // Modèle d'arme : suit le regard avec un léger retard, plus le recul.
    this.vmRecoil *= Math.exp(-11 * dt);
    const vm = this.viewModels[p.loadout.currentId];
    if (vm) {
      const ads = p.ads;
      const baseX = 0.30 * (1 - ads);
      const baseY = -0.27 + 0.055 * ads;
      const baseZ = -0.80 + 0.22 * ads;
      const w = p.loadout.current;
      const reloadDip = w.isReloading ? Math.sin(Math.min(1, 1 - w.reloading / w.def.reloadTime) * Math.PI) : 0;
      vm.position.set(
        baseX + bobX * 0.8,
        baseY + bobY * 0.6 - this.vmRecoil * 0.02 - reloadDip * 0.16,
        baseZ + this.vmRecoil * 0.09
      );
      // Un léger biais de lacet donne du volume à l'arme sans coûter un polygone.
      vm.rotation.set(this.vmRecoil * 0.25 + reloadDip * 0.9, 0.10 * (1 - ads) - ads * 0.02, reloadDip * 0.5);
      vm.visible = p.alive;

      // Flash de bouche : allumé par fireShot, éteint ici. L'étoile est un
      // enfant de l'arme, donc elle suit déjà le recul et le balancement.
      const flash = vm.userData.flash;
      if (flash) {
        if (this.vmFlash > 0) {
          if (!flash.visible) {
            // Nouvelle salve : on retire l'étoile pour que deux coups d'affilée
            // ne se superposent pas exactement.
            flash.rotation.z = Math.random() * Math.PI * 2;
            flash.scale.setScalar(0.85 + Math.random() * 0.3);
          }
          flash.visible = true;
          this.vmFlash -= dt;
        } else if (flash.visible) {
          flash.visible = false;
        }
      }
    }
  }

  render() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.player.alive) {
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
    }
  }

  // ------------------------------------------------------------- score ---

  ranking() {
    return this.actors.slice().sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths) || a.name.localeCompare(b.name));
  }

  rankOf(actor) { return this.ranking().indexOf(actor) + 1; }

  endMatch(reason) {
    if (this.over) return;
    this.over = true;
    this.input.releaseLock();
    Sfx.sfxMatchEnd();
    const results = { reason, ranking: this.ranking(), player: this.player };
    if (this.onEnd) this.onEnd(results);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();
    this.effects.dispose();
    this.world.geometry.dispose();
    this.world.material.dispose();
    this.scene.traverse((o) => {
      if (o.isMesh && o !== this.world.mesh) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { Array.isArray(o.material) ? o.material.forEach((m) => m.dispose()) : o.material.dispose(); }
      }
    });
    this.vmScene.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    this.hud.show(false);
    this.renderer.dispose();
  }
}

// ---------------------------------------------------------------- utils ---

/**
 * Dispersion : on décale la direction dans un petit cône.
 * On construit un repère orthonormé (droite, haut) autour de la direction,
 * puis on tire un point au hasard dans le disque unité (racine carrée pour
 * une densité uniforme, sinon les tirs se concentrent au centre).
 */
function jitter(x, y, z, spread) {
  if (spread <= 0) return { x, y, z };
  // droite = normalize(dir x up), avec un "up" de secours si dir est vertical.
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(y) > 0.98) { ux = 1; uy = 0; }
  let rx = y * uz - z * uy, ry = z * ux - x * uz, rz = x * uy - y * ux;
  const rl = Math.hypot(rx, ry, rz) || 1e-6;
  rx /= rl; ry /= rl; rz /= rl;
  const hx = ry * z - rz * y, hy = rz * x - rx * z, hz = rx * y - ry * x;

  const a = Math.random() * Math.PI * 2;
  const m = Math.sqrt(Math.random()) * spread;
  const ca = Math.cos(a) * m, sa = Math.sin(a) * m;
  const nx = x + rx * ca + hx * sa;
  const ny = y + ry * ca + hy * sa;
  const nz = z + rz * ca + hz * sa;
  const n = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / n, y: ny / n, z: nz / n };
}

function dist3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export { TMP };
