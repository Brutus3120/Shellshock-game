/**
 * audio.js — tous les sons sont SYNTHÉTISÉS via WebAudio.
 * Conséquence : zéro fichier audio à télécharger, quelques Ko de code,
 * et le jeu reste entièrement hors-ligne.
 */

let ctx = null;
let master = null;
let enabled = true;

export function initAudio(volume = 0.6) {
  if (ctx) { setVolume(volume); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { enabled = false; return; }
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function setVolume(v) {
  if (master) master.gain.value = v;
  enabled = v > 0.0001;
}

function noiseBuffer(dur) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Atténuation simple selon la distance à la caméra. */
function distanceGain(dist) {
  if (dist === undefined) return 1;
  return Math.max(0, 1 - dist / 55) ** 1.6;
}

export function sfxShot(weaponId, dist) {
  if (!ctx || !enabled) return;
  const g = distanceGain(dist);
  if (g <= 0.01) return;
  const t = ctx.currentTime;

  const profiles = {
    rafale:  { dur: 0.13, freq: 1400, q: 1.2, level: 0.35, tone: 190 },
    lynx:    { dur: 0.26, freq: 900,  q: 0.9, level: 0.55, tone: 120 },
    broyeur: { dur: 0.30, freq: 640,  q: 0.7, level: 0.60, tone: 90 },
  };
  const p = profiles[weaponId] || profiles.rafale;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(p.dur);
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = p.freq;
  filt.Q.value = p.q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(p.level * g, t);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + p.dur);
  src.connect(filt); filt.connect(gain); gain.connect(master);
  src.start(t); src.stop(t + p.dur);

  // "corps" grave du tir
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(p.tone, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + p.dur * 0.8);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.22 * g, t);
  og.gain.exponentialRampToValueAtTime(0.0008, t + p.dur * 0.8);
  osc.connect(og); og.connect(master);
  osc.start(t); osc.stop(t + p.dur);
}

function blip(freq, dur, level, type = 'square', slideTo = null) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur);
}

export const sfxHit      = () => blip(1250, 0.05, 0.18, 'square');
export const sfxHeadshot = () => blip(1850, 0.09, 0.22, 'square', 2400);
export const sfxKill     = () => { blip(760, 0.09, 0.20, 'triangle'); setTimeout(() => blip(1140, 0.14, 0.20, 'triangle'), 70); };
export const sfxDeath    = () => blip(320, 0.55, 0.28, 'sawtooth', 60);
export const sfxEmpty    = () => blip(180, 0.05, 0.14, 'square');
export const sfxReload   = () => { blip(420, 0.05, 0.13, 'square'); setTimeout(() => blip(620, 0.06, 0.13, 'square'), 130); };
export const sfxPickup   = () => { blip(880, 0.06, 0.16, 'sine'); setTimeout(() => blip(1320, 0.09, 0.16, 'sine'), 60); };
export const sfxSwitch   = () => blip(540, 0.05, 0.12, 'square', 780);
export const sfxUi       = () => blip(660, 0.035, 0.09, 'sine');
export const sfxMatchEnd = () => { [520, 660, 880].forEach((f, i) => setTimeout(() => blip(f, 0.22, 0.2, 'triangle'), i * 150)); };

/** Impact lointain : petit "tac" filtré, utilisé pour les balles adverses. */
export function sfxImpact(dist) {
  if (!ctx || !enabled) return;
  const g = distanceGain(dist) * 0.5;
  if (g <= 0.01) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.05);
  const filt = ctx.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = 2200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.25 * g, t);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
  src.connect(filt); filt.connect(gain); gain.connect(master);
  src.start(t); src.stop(t + 0.05);
}
