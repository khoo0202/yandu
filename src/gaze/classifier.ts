// Per-person gaze classifier: Gaussian classes with one shared covariance (LDA).
// Trained from ~2 s of frames per class during calibration. Tiny on purpose:
// 4 classes x 6 features, so it trains instantly and needs no deep learning.

export type Cls = 'C' | 'L' | 'R' | 'U';

export interface ClassifierModel {
  classes: Cls[];
  mean: Record<string, number[]>;  // in standardised units
  inv: number[][];                 // inverse pooled covariance
  mu0: number[]; sd0: number[];    // standardisation
  style?: string;                  // selection style the calibration was made for
  /** per-person "how far is far enough" for each side, from the calibration frames (see fitThresholds) */
  thr?: Record<string, number>;
}

export interface Prediction { cls: Cls; p: number; probs: Record<string, number> }

function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    [a[c], a[piv]] = [a[piv], a[c]];
    const d = a[c][c] || 1e-9;
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map(r => r.slice(n));
}

export class Classifier {
  m: ClassifierModel;
  constructor(m: ClassifierModel) { this.m = m; }

  static train(samples: Partial<Record<Cls, number[][]>>): Classifier {
    const classes = (Object.keys(samples) as Cls[]).filter(c => (samples[c]?.length ?? 0) > 0);
    const all = classes.flatMap(c => samples[c]!);
    const d = all[0].length;
    const mu0 = Array(d).fill(0), sd0 = Array(d).fill(0);
    for (const x of all) x.forEach((v, i) => (mu0[i] += v / all.length));
    for (const x of all) x.forEach((v, i) => (sd0[i] += (v - mu0[i]) ** 2 / all.length));
    for (let i = 0; i < d; i++) sd0[i] = Math.sqrt(sd0[i]) || 1;
    const z = (x: number[]) => x.map((v, i) => (v - mu0[i]) / sd0[i]);
    const mean: Record<string, number[]> = {};
    const cov = Array.from({ length: d }, () => Array(d).fill(0));
    let n = 0;
    for (const c of classes) {
      const xs = samples[c]!.map(z);
      const mu = Array(d).fill(0);
      for (const x of xs) x.forEach((v, i) => (mu[i] += v / xs.length));
      mean[c] = mu;
      for (const x of xs) for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) cov[i][j] += (x[i] - mu[i]) * (x[j] - mu[j]);
      n += xs.length;
    }
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) cov[i][j] /= Math.max(1, n - classes.length);
    // shrink towards the diagonal and add a floor so a still face doesn't give a singular matrix
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) cov[i][j] = i === j ? cov[i][j] + 0.02 : cov[i][j] * 0.7;
    return new Classifier({ classes, mean, inv: invert(cov), mu0, sd0 });
  }

  private z(x: number[]) { return x.map((v, i) => (v - this.m.mu0[i]) / this.m.sd0[i]); }

  private maha(zx: number[], mu: number[]) {
    const d = zx.map((v, i) => v - mu[i]);
    let s = 0;
    for (let i = 0; i < d.length; i++) for (let j = 0; j < d.length; j++) s += d[i] * this.m.inv[i][j] * d[j];
    return s;
  }

  predict(x: number[], allowed?: Cls[]): Prediction {
    const zx = this.z(x);
    const cs = this.m.classes.filter(c => !allowed || allowed.includes(c) || c === 'C');
    const logits = cs.map(c => -0.5 * this.maha(zx, this.m.mean[c]) + (c === 'C' ? Math.log(2) : 0));
    const mx = Math.max(...logits);
    const ex = logits.map(l => Math.exp(l - mx));
    const sum = ex.reduce((a, b) => a + b, 0);
    const probs: Record<string, number> = {};
    cs.forEach((c, i) => (probs[c] = ex[i] / sum));
    let best = 0;
    for (let i = 1; i < cs.length; i++) if (ex[i] > ex[best]) best = i;
    return { cls: cs[best], p: ex[best] / sum, probs };
  }

  /** How far apart two classes are, in standard deviations (above ~3 is easy to tell apart). */
  separation(a: Cls, b: Cls): number {
    if (!this.m.mean[a] || !this.m.mean[b]) return 0;
    return Math.sqrt(this.maha(this.m.mean[a], this.m.mean[b]));
  }

  /**
   * How far `x` has travelled from the screen ("C") towards class `cls`:
   * 0 = typical reading position, 1 = where the patient looked during calibration.
   */
  reach(x: number[], cls: Cls): number {
    const c = this.m.mean.C, k = this.m.mean[cls];
    if (!c || !k) return 0;
    const zx = this.z(x);
    const d = zx.map((v, i) => v - c[i]), v = k.map((m, i) => m - c[i]);
    let num = 0, den = 0;
    for (let i = 0; i < d.length; i++) for (let j = 0; j < d.length; j++) {
      num += d[i] * this.m.inv[i][j] * v[j];
      den += v[i] * this.m.inv[i][j] * v[j];
    }
    return den > 0 ? num / den : 0;
  }

  /**
   * Choose, for each side, how far the eyes must travel before it counts:
   * halfway between the far end of reading (95th percentile of the screen frames)
   * and the near end of the calibration look (25th percentile of that side's frames).
   * Returns which sides can be told apart from reading at all.
   */
  fitThresholds(samples: Partial<Record<Cls, number[][]>>): Record<string, boolean> {
    const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };
    const thr: Record<string, number> = {}, ok: Record<string, boolean> = {};
    for (const k of ['L', 'R', 'U'] as Cls[]) {
      if (!samples[k]?.length || !this.m.mean[k]) continue;
      const readFar = pct((samples.C ?? []).map(x => this.reach(x, k)), 0.95);
      const lookNear = pct(samples[k]!.map(x => this.reach(x, k)), 0.25);
      ok[k] = lookNear > readFar + 0.05;
      thr[k] = Math.min(0.85, Math.max(0.25, ok[k] ? (readFar + lookNear) / 2 : lookNear * 0.9));
    }
    this.m.thr = thr;
    return ok;
  }

  /** Head moved: shift every class by part of the drift seen while the patient looks at the centre. */
  drift(centreFrames: number[][], alpha = 0.1) {
    if (!centreFrames.length || !this.m.mean.C) return;
    const d = this.m.mean.C.length;
    const m = Array(d).fill(0);
    for (const x of centreFrames.map(f => this.z(f))) x.forEach((v, i) => (m[i] += v / centreFrames.length));
    const delta = m.map((v, i) => alpha * (v - this.m.mean.C[i]));
    for (const c of this.m.classes) this.m.mean[c] = this.m.mean[c].map((v, i) => v + delta[i]);
  }
}
