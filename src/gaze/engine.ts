// Camera -> MediaPipe -> features -> classifier -> events.
// Emits the same events the keyboard and touch inputs do, so the rest of the
// app never needs to know whether a choice came from the eyes.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { extract, type Frame } from './features.ts';
import { Classifier, type Cls, type ClassifierModel } from './classifier.ts';
import { settings, loadJSON, saveJSON } from '../store.ts';
import type { Dir } from '../engine/tree.ts';

const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
/** flick: still looking away this long after a choice = looking at something else, so the choice is taken back */
const AUTO_UNDO_MS = 1400;
/** how far towards the calibrated "outside" position the eyes must go (0 = reading, 1 = calibration) */
const REACH: Record<string, number> = { L: 0.5, R: 0.5, U: 0.8 };
const REMOTE_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

export interface GazeHandlers {
  progress(dir: Dir | null, p: number): void;
  select(dir: Dir): void;
  /** flick mode: the eyes stayed outside long after a choice, take it back */
  lookedAway(): void;
  backProgress(p: number): void;
  back(): void;
  call(): void;
  face(present: boolean): void;
  quality(msg: string | null): void;
}

export class GazeEngine {
  video: HTMLVideoElement;
  private lm: FaceLandmarker | null = null;
  clf: Classifier | null = null;
  private h: GazeHandlers;
  running = false;
  paused = false;
  /** directions the current screen accepts */
  dirs: Dir[] = ['L', 'R'];
  /** one direction needs a longer hold (used by the rest screen) */
  holdOverride: { dir: Dir; ms: number } | null = null;
  last: Frame | null = null;
  lastPred: { cls: Cls; p: number } | null = null;

  private lastT = 0;
  private faceSeenAt = 0;
  private facePresent = false;
  private side: Dir | null = null;
  private sideSince = 0;
  private armed = true;
  private centreSince = 0;
  private coolUntil = 0;
  private closedSince = 0;
  private backFired = false;
  private shortBlinks: number[] = [];
  private upSince = 0;
  private centreBuf: number[][] = [];
  private lastDrift = 0;
  private lastQuality = 0;
  private sink: number[][] | null = null;
  /** flick mode: the side the eyes went out to, and when */
  private out: { dir: Dir; since: number; fired: boolean; undone: boolean } | null = null;
  private canvas = document.createElement('canvas');

  constructor(video: HTMLVideoElement, handlers: GazeHandlers) {
    this.video = video;
    this.h = handlers;
    const saved = loadJSON<ClassifierModel>('yandu2.calib');
    // a calibration made for the other selection style would misread the eyes
    if (saved && (saved.style ?? 'onscreen') === settings.selectStyle) this.clf = new Classifier(saved);
  }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocam');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
    });
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
  }

  stopCamera() {
    const s = this.video.srcObject as MediaStream | null;
    s?.getTracks().forEach(t => t.stop());
    this.video.srcObject = null;
  }

  async loadModel() {
    const base = import.meta.env.BASE_URL;
    let wasm = `${base}mediapipe/wasm`;
    let model = `${base}models/face_landmarker.task`;
    try {
      const r = await fetch(model, { method: 'HEAD' });
      if (!r.ok) model = REMOTE_MODEL;
    } catch { model = REMOTE_MODEL; }
    try {
      const r = await fetch(`${wasm}/vision_wasm_internal.js`, { method: 'HEAD' });
      if (!r.ok) wasm = REMOTE_WASM;
    } catch { wasm = REMOTE_WASM; }
    const fs = await FilesetResolver.forVisionTasks(wasm);
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO' as const, numFaces: 1, outputFaceBlendshapes: true,
    });
    try { this.lm = await FaceLandmarker.createFromOptions(fs, opts('GPU')); }
    catch { this.lm = await FaceLandmarker.createFromOptions(fs, opts('CPU')); }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      this.step();
    };
    requestAnimationFrame(tick);
  }

  stop() { this.running = false; }

  /** Ignore input for a moment, e.g. right after the screen changes. */
  cooldown(ms = 400) {
    this.coolUntil = performance.now() + ms;
    this.side = null;
    this.h.progress(null, 0);
  }

  /** Collect feature frames (eyes open) for `ms` milliseconds. */
  async collect(ms: number): Promise<number[][]> {
    this.sink = [];
    await new Promise(r => setTimeout(r, ms));
    const got = this.sink;
    this.sink = null;
    return got;
  }

  setClassifier(c: Classifier) {
    c.m.style = settings.selectStyle;
    this.clf = c;
    saveJSON('yandu2.calib', c.m);
    this.armed = true;
  }

  private step() {
    if (!this.lm || this.video.readyState < 2) return;
    const now = performance.now();
    if (now - this.lastT < 45) return; // ~20 frames per second is plenty and saves battery
    this.lastT = now;
    let res;
    try { res = this.lm.detectForVideo(this.video, now); } catch { return; }
    const f = extract(res.faceLandmarks?.[0], res.faceBlendshapes?.[0]?.categories);
    this.last = f;

    if (!f) {
      if (this.facePresent && now - this.faceSeenAt > 600) {
        this.facePresent = false;
        this.out = null;
        this.h.face(false);
        this.side = null;
        this.h.progress(null, 0);
      }
      return;
    }
    this.faceSeenAt = now;
    if (!this.facePresent) { this.facePresent = true; this.h.face(true); this.cooldown(500); }

    if (now - this.lastQuality > 1000) { this.lastQuality = now; this.h.quality(this.checkQuality(f)); }

    if (this.sink) { if (f.blink < 0.4) this.sink.push(f.x); return; }
    if (!this.clf || this.paused) return;

    // ---- eyes closed: long close = back, three quick blinks = call ----
    if (f.blink > 0.5) {
      if (!this.closedSince) { this.closedSince = now; this.backFired = false; }
      const p = (now - this.closedSince) / settings.backMs;
      if (now - this.closedSince > 400) this.out = null;
      this.side = null;
      this.h.progress(null, 0);
      if (!this.backFired) {
        this.h.backProgress(Math.min(1, p));
        if (p >= 1) { this.backFired = true; this.h.backProgress(0); this.h.back(); this.cooldown(600); }
      }
      return;
    }
    if (this.closedSince) {
      const dur = now - this.closedSince;
      this.closedSince = 0;
      this.h.backProgress(0);
      if (dur < 400) {
        this.shortBlinks = this.shortBlinks.filter(t => now - t < 1500);
        this.shortBlinks.push(now);
        if (this.shortBlinks.length >= 3 && settings.callGesture === 'triple') {
          this.shortBlinks = [];
          this.h.call();
          return;
        }
      }
    }

    // ---- direction ----
    const allowed: Cls[] = ['L', 'R', ...(settings.ways === 3 || settings.callGesture === 'up' ? ['U' as Cls] : [])];
    const pred = this.clf.predict(f.x, allowed);
    this.lastPred = pred;

    // look up for 2 s = call (only when "up" is not a choice)
    if (settings.callGesture === 'up' && !this.dirs.includes('U')) {
      if (pred.cls === 'U' && pred.p > settings.confidence) {
        if (!this.upSince) this.upSince = now;
        if (now - this.upSince > 2000) { this.upSince = 0; this.h.call(); return; }
      } else this.upSince = 0;
    }

    if (pred.cls === 'C') {
      if (!this.centreSince) this.centreSince = now;
      if (now - this.centreSince > 150) this.armed = true;
      // drift correction from steady centre frames
      if (pred.p > 0.9) {
        this.centreBuf.push(f.x);
        if (this.centreBuf.length > 20) this.centreBuf.shift();
        if (now - this.centreSince > 800 && now - this.lastDrift > 2000 && this.centreBuf.length >= 10) {
          this.clf.drift(this.centreBuf, 0.1);
          this.lastDrift = now;
          this.centreBuf = [];
        }
      }
    } else this.centreSince = 0;

    let dir = (pred.cls !== 'C' && pred.p >= settings.confidence && this.dirs.includes(pred.cls as Dir)) ? pred.cls as Dir : null;
    // up is the hardest to tell from reading the top line: ask for more certainty and a clearer look
    if (dir === 'U' && pred.p < Math.max(settings.confidence, 0.93)) dir = null;
    if (dir && this.clf.reach(f.x, dir) < REACH[dir]) dir = null;
    if (settings.trigger === 'flick' && !this.holdOverride) { this.flick(dir, pred.cls === 'C', now); return; }
    if (!this.armed || now < this.coolUntil) {
      this.side = null;
      this.h.progress(null, 0);
      return;
    }
    if (dir !== this.side) { this.side = dir; this.sideSince = now; }
    if (!dir) { this.h.progress(null, 0); return; }
    const hold = this.holdOverride && this.holdOverride.dir === dir ? this.holdOverride.ms
      : settings.trigger === 'glance' ? settings.glanceMs : settings.dwellMs;
    const p = (now - this.sideSince) / hold;
    this.h.progress(dir, Math.min(1, p));
    if (p >= 1) {
      this.armed = false;
      this.side = null;
      this.h.progress(null, 0);
      this.h.select(dir);
    }
  }

  /**
   * Flick: a short look past the edge chooses that side straight away. The eyes
   * must come back to the screen before the next choice. If they stay outside
   * well after the choice (someone walked in), the choice is taken back.
   */
  private flick(dir: Dir | null, centre: boolean, now: number) {
    if (now < this.coolUntil) { this.out = null; this.h.progress(null, 0); return; }
    if (dir) {
      if (!this.out || this.out.dir !== dir) this.out = { dir, since: now, fired: false, undone: false };
      const o = this.out;
      const t = now - o.since;
      if (!o.fired) {
        if (!this.armed) { this.h.progress(null, 0); return; }
        const need = dir === 'U' ? Math.max(settings.flickMs, 180) : settings.flickMs;
        this.h.progress(dir, Math.min(1, t / need));
        if (t >= need) {
          o.fired = true;
          this.armed = false;
          this.h.progress(null, 0);
          this.h.select(dir);
        }
      } else if (!o.undone && t > AUTO_UNDO_MS) {
        o.undone = true;
        this.h.lookedAway();
      }
      return;
    }
    if (centre) this.out = null;
    this.h.progress(null, 0);
  }

  /** Light, distance and angle check. Returns a message to show, or null when fine. */
  checkQuality(f: Frame): string | null {
    if (f.eyeDist < 0.09) return '脸离手机太远，请把手机移近一点';
    if (f.eyeDist > 0.42) return '脸离手机太近，请把手机移远一点';
    if (f.x[2] < 0.25 || f.x[2] > 0.75) return '脸没有正对手机，请把手机移到脸的正前方';
    const b = this.brightness(f);
    if (b != null && b < 55) return '脸太暗，请打开灯或把脸转向光';
    return null;
  }

  private brightness(f: Frame): number | null {
    try {
      const w = 32, h = 24;
      this.canvas.width = w; this.canvas.height = h;
      const c = this.canvas.getContext('2d', { willReadFrequently: true });
      if (!c) return null;
      c.drawImage(this.video, 0, 0, w, h);
      const x0 = Math.floor(f.box.x * w), y0 = Math.floor(f.box.y * h);
      const bw = Math.max(1, Math.floor(f.box.w * w)), bh = Math.max(1, Math.floor(f.box.h * h));
      const d = c.getImageData(Math.max(0, x0), Math.max(0, y0), Math.min(bw, w - x0), Math.min(bh, h - y0)).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      return s / (d.length / 4);
    } catch { return null; }
  }
}
