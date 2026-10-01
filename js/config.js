/**
 * config.js — toutes les constantes de gameplay.
 * Un seul endroit à modifier pour rééquilibrer le jeu.
 */

export const TICK_MAX = 1 / 30;        // pas de simulation maximal (anti "tunneling" après un lag)

export const PLAYER = {
  radius: 0.34,
  heightStand: 1.80,
  heightCrouch: 1.10,
  eyeOffset: 0.22,        // distance entre le sommet du corps et les yeux
  speedWalk: 5.2,
  speedRun: 8.4,
  speedCrouch: 2.6,
  speedAir: 0.9,          // facteur de contrôle en l'air
  accelGround: 62,
  accelAir: 14,
  frictionGround: 11,
  jumpSpeed: 6.4,
  gravity: 20.5,
  stepHeight: 0.62,       // hauteur de marche franchissable automatiquement
  maxHealth: 100,
  respawnDelay: 2.2,
  coyoteTime: 0.10,       // tolérance de saut après avoir quitté le sol
  jumpBuffer: 0.12,
};

export const BOT = {
  radius: 0.34,
  height: 1.75,
  maxHealth: 100,
  respawnDelay: 3.0,
  gravity: 20.5,
  stepHeight: 0.62,
  accel: 34,
  friction: 9,
  jumpSpeed: 6.0,
  eyeOffset: 0.22,
};

/**
 * Trois armes aux rôles nettement différents.
 *
 * `muzzle` décrit le flash de bouche : rayon en mètres, couleur et durée en
 * secondes. C'est ce qui donne à chaque arme son départ de coup — le Broyeur-12
 * crache large et orangé, le Lynx-M sec et blanc.
 */
export const WEAPONS = {
  rafale: {
    id: 'rafale',
    name: 'Rafale-9',
    role: 'Automatique',
    auto: true,
    damage: 16,
    pellets: 1,
    rpm: 680,
    mag: 30,
    reserve: 180,
    reloadTime: 1.9,
    spreadHip: 0.030,
    spreadAds: 0.008,
    spreadMove: 0.030,
    recoil: 0.85,
    range: 75,
    falloffStart: 30,
    falloffMin: 0.55,
    headMul: 1.8,
    adsFovMul: 0.80,
    color: 0x6fd3ff,
    body: [0.10, 0.13, 0.62],
    muzzle: { size: 0.36, color: 0xffe9a8, life: 0.045 },
  },
  lynx: {
    id: 'lynx',
    name: 'Lynx-M',
    role: 'Précision',
    auto: false,
    damage: 62,
    pellets: 1,
    rpm: 195,
    mag: 8,
    reserve: 48,
    reloadTime: 2.4,
    spreadHip: 0.055,
    spreadAds: 0.0012,
    spreadMove: 0.045,
    recoil: 2.6,
    range: 160,
    falloffStart: 110,
    falloffMin: 0.80,
    headMul: 2.2,
    adsFovMul: 0.42,
    color: 0xffd166,
    body: [0.09, 0.12, 0.86],
    muzzle: { size: 0.46, color: 0xfff3c0, life: 0.065 },
  },
  broyeur: {
    id: 'broyeur',
    name: 'Broyeur-12',
    role: 'Courte portée',
    auto: false,
    damage: 11,
    pellets: 9,
    rpm: 78,
    mag: 6,
    reserve: 36,
    reloadTime: 2.7,
    spreadHip: 0.075,
    spreadAds: 0.050,
    spreadMove: 0.020,
    recoil: 2.9,
    range: 26,
    falloffStart: 7,
    falloffMin: 0.12,
    headMul: 1.4,
    adsFovMul: 0.92,
    color: 0xff7a6b,
    body: [0.12, 0.15, 0.58],
    muzzle: { size: 0.58, color: 0xffc98a, life: 0.075 },
  },
};

/**
 * Catalogue et inventaire sont deux choses différentes, et le code les a
 * longtemps confondues dans une seule constante.
 *
 * Le CATALOGUE est ce qui existe : toutes les armes du jeu. Il est dérivé de
 * WEAPONS et non recopié, donc il ne peut pas en diverger ; l'ordre
 * d'insertion des clés lui donne un ordre stable pour les menus.
 *
 * L'INVENTAIRE est ce qu'on porte : SLOT_COUNT emplacements, un par touche
 * 1/2/3 et par case d'ATH. Ce nombre est fixe par conception, quelle que soit
 * la taille du catalogue (voir Loadout dans weapons.js).
 */
export const WEAPON_CATALOG = Object.keys(WEAPONS);
export const SLOT_COUNT = 3;

/** Inventaire du joueur, en attendant l'écran d'équipement du menu. */
export const DEFAULT_SLOTS = ['rafale', 'lynx', 'broyeur'];

/** Trois niveaux de difficulté pour les bots. */
export const DIFFICULTIES = {
  facile: {
    id: 'facile', label: 'Facile',
    health: 80, aimError: 0.075, reaction: 0.60, fireRateMul: 0.55,
    speedMul: 0.80, viewDist: 38, fov: 1.55, coverChance: 0.15,
    leadFactor: 0.0, burstMin: 0.45, burstMax: 0.9, strafe: 0.5, damageMul: 0.65,
  },
  normal: {
    id: 'normal', label: 'Normal',
    health: 100, aimError: 0.030, reaction: 0.32, fireRateMul: 0.85,
    speedMul: 0.95, viewDist: 55, fov: 1.75, coverChance: 0.40,
    leadFactor: 0.5, burstMin: 0.7, burstMax: 1.4, strafe: 0.8, damageMul: 0.85,
  },
  difficile: {
    id: 'difficile', label: 'Difficile',
    health: 120, aimError: 0.011, reaction: 0.16, fireRateMul: 1.0,
    speedMul: 1.06, viewDist: 75, fov: 2.05, coverChance: 0.70,
    leadFactor: 1.0, burstMin: 1.0, burstMax: 2.0, strafe: 1.0, damageMul: 1.0,
  },
};

/**
 * Presets graphiques. Le préréglage "bas" vise les PC sans GPU dédié.
 *
 * `aoTile` est la finesse de l'occlusion ambiante cuite dans le décor (voir
 * world.js) : c'est le côté maximal d'un quad, en mètres. Plus il est petit,
 * plus les ombres de contact sont nettes — et plus la carte compte de
 * triangles. Comme la géométrie est construite une fois par partie, ce réglage
 * ne coûte rien pendant le jeu ; il fixe seulement le budget géométrique.
 */
export const QUALITY = {
  bas:    { id: 'bas',    label: 'Bas',    renderScale: 0.65, shadows: false, fogFar: 90,  particles: 0.4, tracers: true, aoTile: 1.7 },
  moyen:  { id: 'moyen',  label: 'Moyen',  renderScale: 0.85, shadows: false, fogFar: 140, particles: 1.0, tracers: true, aoTile: 1.2 },
  haut:   { id: 'haut',   label: 'Haut',   renderScale: 1.00, shadows: true,  fogFar: 220, particles: 1.4, tracers: true, aoTile: 0.9 },
};

export const PICKUP = {
  healthAmount: 35,
  ammoMags: 2,
  respawnTime: 14,
  radius: 1.1,
};

/** Noms de bots (thème original "Éclat", rien d'emprunté). */
export const BOT_NAMES = [
  'Vex', 'Orbe', 'Kito', 'Sable', 'Nyx', 'Prune', 'Halo', 'Rouille',
  'Cobalt', 'Muse', 'Fable', 'Cendre', 'Zigg', 'Onyx', 'Pyrite', 'Lumen',
];

/**
 * Orange de signal. Il désigne l'hostile et le danger, et RIEN d'autre : le
 * chevron d'épaule des bots aujourd'hui, les zones d'explosion et les dégâts
 * reçus ensuite. Son pendant est le teal `#4fd1c5` de l'interface et du
 * joueur (voir `--accent` dans style.css). Ces deux teintes sont réservées :
 * c'est ce qui garantit qu'une tache orange à 40 m est toujours une cible, et
 * jamais un mur ni un élément d'ATH.
 */
export const SIGNAL_ORANGE = 0xff7a3c;

/**
 * Couleurs d'équipe des bots. Aucune ne doit s'approcher des deux teintes de
 * signal : trois d'entre elles le faisaient et ont été remplacées — un cyan
 * (0x5ad1e8) et un turquoise (0x4ad8c8) à quelques degrés du teal d'interface,
 * un orange brûlé (0xd88a4a) qui entrait en collision avec le chevron, et un
 * saumon (0xe86a5a) sur lequel un chevron orange ne se détachait pas — vérifié
 * en capture, c'est le cas qui ruinait la règle du signal.
 * Les bandes de teinte libres sont le rouge, le jaune, le vert, le bleu et le
 * magenta ; le cyan-turquoise (160-200°) et l'orange (10-40°) sont interdits.
 */
export const BOT_COLORS = [
  0xe85a5a, 0xd84ad8, 0xe8c65a, 0x9a6ae8, 0x5ae88c, 0xe85aa8,
  0x6a8ce8, 0xc8e84a, 0x8ce85a, 0x5a9ae8, 0x6a5ae8, 0xb8b8c8,
];
