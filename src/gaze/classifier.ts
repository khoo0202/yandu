// Per-person gaze classifier: Gaussian classes with one shared covariance (LDA).
// Trained from ~2 s of frames per class during calibration. Tiny on purpose:
// 4 classes x 6 features, so it trains instantly and needs no deep learning.

export type Cls = 'C' | 'L' | 'R' | 'U';

export interface ClassifierModel {
  classes: Cls[];
  mean: Record<string, number[]>;  // in standardised units
  inv: number[][];                 // inverse pooled covariance
  mu0: number[]; sd0: number[];    // standardisation
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
