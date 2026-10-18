// Settings and patient profile, kept in this phone's browser storage.

/** dwell: hold the look; glance: a short hold; flick: look out and come straight back (outside mode) */
export type Trigger = 'dwell' | 'glance' | 'flick';
export type CallGesture = 'triple' | 'up' | 'off';
/** outside: read anywhere on screen, choose by looking past the phone's edge. onscreen: look at a side to choose. */
export type SelectStyle = 'outside' | 'onscreen';

export interface Settings {
  v: number;                // settings format version, for one-off migrations
  selectStyle: SelectStyle; // how a choice is made (see above)
  ways: 2 | 3;              // number of choice regions (3 adds "look up")
  trigger: Trigger;         // see Trigger
  dwellMs: number;          // hold time in dwell mode
  glanceMs: number;         // hold time in glance mode
  flickMs: number;          // flick mode: this long past the edge chooses
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
  v: 4, selectStyle: 'outside', ways: 3, trigger: 'flick', dwellMs: 700, glanceMs: 300, flickMs: 150, confidence: 0.8, backMs: 2000,
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
// one-off upgrades of settings saved by older versions
const storedV = loadJSON<{ v?: number }>('yandu2.settings')?.v ?? (loadJSON('yandu2.settings') ? 1 : DEFAULT_SETTINGS.v);
if (storedV < DEFAULT_SETTINGS.v) {
  // v2: "look out and come back" became the way to choose in outside mode
  if (storedV < 2 && settings.selectStyle === 'outside') settings.trigger = 'flick';
  // v3: three directions (left, right, up). Recalibrate so "up" is measured and checked.
  if (storedV < 3) settings.ways = 3;
  // v4: calibration also measures reading at the very top of the screen, so "up" is not
  // mistaken for reading the sentence. Recalibrate once.
  if (storedV < 4) {
    try { localStorage.removeItem('yandu2.calib'); } catch { /* ignore */ }
  }
  settings.v = DEFAULT_SETTINGS.v;
  try { localStorage.setItem('yandu2.settings', JSON.stringify(settings)); } catch { /* ignore */ }
}
export const profile: Profile = load('yandu2.profile', DEFAULT_PROFILE);

export function saveSettings() { save('yandu2.settings', settings); }
export function saveProfile() { save('yandu2.profile', profile); }

export function loadJSON<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
export function saveJSON(key: string, v: unknown) { save(key, v); }
