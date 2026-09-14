/**
 * settings.js — préférences persistées dans localStorage.
 * Aucun compte, aucun serveur : tout reste dans le navigateur.
 */

const KEY = 'eclat-fps.settings.v1';

const DEFAULTS = {
  sensitivity: 1.0,
  fov: 82,
  quality: 'moyen',
  showMinimap: true,
  showFps: true,
  volume: 0.6,
  invertY: false,
  // derniers réglages de partie
  map: 'arene',
  botCount: 5,
  difficulty: 'normal',
  duration: 300,
  scoreLimit: 25,
  weapon: 'rafale',
};

export const settings = { ...DEFAULTS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return settings;
    const data = JSON.parse(raw);
    for (const k of Object.keys(DEFAULTS)) {
      if (data[k] !== undefined && typeof data[k] === typeof DEFAULTS[k]) settings[k] = data[k];
    }
  } catch (_) { /* stockage indisponible : on garde les valeurs par défaut */ }
  return settings;
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (_) {}
}

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  saveSettings();
}
