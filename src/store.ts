// Settings and patient profile, kept in this phone's browser storage.

export type Trigger = 'dwell' | 'glance';
export type CallGesture = 'triple' | 'up' | 'off';

export interface Settings {
  ways: 2 | 3;              // number of choice regions (3 adds "look up")
  trigger: Trigger;         // dwell: hold the look; glance: a short look is enough
  dwellMs: number;          // hold time in dwell mode
  glanceMs: number;         // hold time in glance mode
  confidence: number;       // 0.5..0.95, how sure the classifier must be
  backMs: number;           // eyes closed this long = go back one step
  callGesture: CallGesture; // how the patient calls for help from any screen
  readOptions: boolean;     // read out what is on each side at every step
  autoSlow: boolean;        // slow down after repeated undo
  speakPreviewMs: number;   // board items are shown this long before being read out
  rate: number;             // speech rate
}

export interface Profile {
  pinyin: boolean;          // patient can use the spelling mode
  family: string[];         // names used in "叫人"
  setupDone: boolean;
  tutorialDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  ways: 2, trigger: 'dwell', dwellMs: 700, glanceMs: 300, confidence: 0.8, backMs: 2000,
  callGesture: 'triple', readOptions: false, autoSlow: true, speakPreviewMs: 1500, rate: 0.9,
};

export const DEFAULT_PROFILE: Profile = { pinyin: true, family: [], setupDone: false, tutorialDone: false };

function load<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...def, ...JSON.parse(raw) } : { ...def };
  } catch { return { ...def }; }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked: keep in memory */ }
}

export const settings: Settings = load('yandu2.settings', DEFAULT_SETTINGS);
export const profile: Profile = load('yandu2.profile', DEFAULT_PROFILE);

export function saveSettings() { save('yandu2.settings', settings); }
export function saveProfile() { save('yandu2.profile', profile); }

export function loadJSON<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
export function saveJSON(key: string, v: unknown) { save(key, v); }
