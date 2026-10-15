// Text-to-speech and short sound cues.

let voice: SpeechSynthesisVoice | null = null;
let rate = 0.9;

function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices();
    voice = vs.find(v => /zh[-_]CN/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null;
  } catch { /* no speech support */ }
}
try { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; } catch { /* ignore */ }

export function setRate(r: number) { rate = r; }

export function hasChineseVoice(): boolean { pickVoice(); return !!voice; }

/** Speak `text`. `interrupt` cancels whatever is being said. Resolves when done (or after a timeout). */
export function say(text: string, interrupt = true): Promise<void> {
  return new Promise(resolve => {
    try {
      if (interrupt) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      if (voice) u.voice = voice;
      u.rate = rate;
      const t = setTimeout(resolve, 600 + text.length * 450);
      u.onend = () => { clearTimeout(t); resolve(); };
      u.onerror = () => { clearTimeout(t); resolve(); };
      speechSynthesis.speak(u);
    } catch { resolve(); }
  });
}

export function stopSpeaking() { try { speechSynthesis.cancel(); } catch { /* ignore */ } }

let ac: AudioContext | null = null;
function ctx(): AudioContext | null {
  try {
    ac = ac || new AudioContext();
    if (ac.state === 'suspended') void ac.resume();
    return ac;
  } catch { return null; }
}

function tone(freq: number, ms: number, gain = 0.12, when = 0) {
  const a = ctx(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, a.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + when + ms / 1000);
  o.connect(g); g.connect(a.destination);
  o.start(a.currentTime + when); o.stop(a.currentTime + when + ms / 1000 + 0.02);
}

export type Earcon = 'L' | 'R' | 'U' | 'back' | 'ok' | 'error' | 'unlock';

export function earcon(kind: Earcon) {
  switch (kind) {
    case 'L': tone(600, 90); break;
    case 'R': tone(720, 90); break;
    case 'U': tone(840, 90); break;
    case 'back': tone(440, 120); tone(330, 160, 0.12, 0.12); break;
    case 'ok': tone(660, 90); tone(880, 140, 0.12, 0.1); break;
    case 'error': tone(300, 200); break;
    case 'unlock': tone(523, 80); tone(659, 80, 0.12, 0.09); tone(784, 120, 0.12, 0.18); break;
  }
}

let alarmTimer: number | null = null;
export function startAlarm() {
  stopAlarm();
  const beep = () => { tone(988, 180, 0.25); tone(784, 180, 0.25, 0.22); };
  beep();
  alarmTimer = window.setInterval(beep, 900);
}
export function stopAlarm() {
  if (alarmTimer != null) { clearInterval(alarmTimer); alarmTimer = null; }
}

/** Must be called from a user gesture once, so later sounds are allowed. */
export function unlockAudio() {
  ctx();
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* ignore */ }
}
