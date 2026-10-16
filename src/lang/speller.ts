import type { Node } from '../engine/tree.ts';

// Spelling for the patient. Each round offers:
//   - a few guesses for what comes next (whole phrases, next words), and
//   - "按声母找": pick the pinyin initial, then the character or word that starts with it.
// Guesses come from the bedside sentences and from spoken-language frequencies.

export interface LexiconData {
  init: string[];                 // "code:pinyin:example:share-per-mille"
  chars: Record<string, string>;  // code -> everyday characters, most frequent first
  more?: Record<string, string>;  // code -> the rest of the standard characters
  words: string;                  // comma separated, most frequent first
  keys: string;                   // initial codes per word, same order
  bi: string;                     // "A + likely next chars", space separated
  wbi?: string;                   // "word|next,next,..." from the bedside sentences
}

export interface Initial { code: string; py: string; example: string; share: number }

export interface Candidate { text: string; consume: number }

// Example characters a bedside user is likely to recognise, one per initial.
const EXAMPLES: Record<string, string> = {
  b: '不', p: '怕', m: '妈', f: '饭', d: '大', t: '疼', n: '你', l: '来', g: '哥', k: '看', h: '喝',
  j: '家', q: '去', x: '想', Z: '这', C: '吃', S: '水', r: '人', z: '在', c: '菜', s: '睡', y: '要', w: '我', _: '爱',
};

const PUNCT = /[^一-鿿]/g;

export interface SpellOptions {
  /** shape the initials tree by how common each initial is (still a fixed tree) */
  weightedInitials?: boolean;
  /** how many guesses to offer each round */
  guesses?: number;
  /** scales how much of each round the guesses get (1 = default) */
  guessMass?: number;
}

export class Speller {
  readonly initials: Initial[];
  readonly opts: Required<SpellOptions>;
  private charInit = new Map<string, string>();
  private byInit = new Map<string, string[]>();
  private moreByInit = new Map<string, string[]>();
  private words: string[];
  private keys: string[];
  private vocab: Set<string>;
  private bi = new Map<string, string>();
  private wbi = new Map<string, string[]>();
  private phrases: string[] = [];
  private starters: string[] = [];

  constructor(data: LexiconData, phrases: string[] = [], opts: SpellOptions = {}) {
    this.opts = { weightedInitials: true, guesses: 5, guessMass: 1, ...opts };
    this.initials = data.init.map(s => {
      const [code, py, ex, share] = s.split(':');
      return { code, py, example: EXAMPLES[code] ?? ex ?? '', share: Number(share) || 1 };
    });
    for (const [code, cs] of Object.entries(data.chars)) {
      this.byInit.set(code, [...cs]);
      for (const c of cs) this.charInit.set(c, code);
    }
    for (const [code, cs] of Object.entries(data.more ?? {})) {
      this.moreByInit.set(code, [...cs]);
      for (const c of cs) this.charInit.set(c, code);
    }
    this.words = data.words.split(',');
    this.keys = data.keys.split(',');
    this.vocab = new Set(this.words);
    for (const row of data.bi.split(' ')) if (row) this.bi.set(row[0], row.slice(1));
    for (const row of (data.wbi ?? '').split(' ')) {
      const [w, next] = row.split('|');
      if (w && next) this.wbi.set(w, next.split(','));
    }
    const seen = new Set<string>();
    const startCount = new Map<string, number>();
    for (const p of phrases) {
      const t = p.replace(PUNCT, '');
      if (!t || seen.has(t)) continue;
      seen.add(t);
      this.phrases.push(t);
      const first = this.segment(t)[0];
      startCount.set(first, (startCount.get(first) ?? 0) + 1);
    }
    this.starters = [...startCount.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  }

  initialOf(c: string): string { return this.charInit.get(c) ?? ''; }

  keyOf(text: string): string {
    let k = '';
    for (const c of text) { const i = this.charInit.get(c); if (i) k += i; }
    return k;
  }

  pinyinOf(code: string): string { return this.initials.find(i => i.code === code)?.py ?? code; }

  /** Forward maximum matching with the spoken vocabulary. */
  segment(t: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < t.length;) {
      let L = Math.min(4, t.length - i);
      while (L > 1 && !this.vocab.has(t.slice(i, i + L))) L--;
      out.push(t.slice(i, i + L));
      i += L;
    }
    return out;
  }

  private bigramBonus(last: string, c: string): number {
    const row = this.bi.get(last);
    if (!row) return 0;
    const pos = row.indexOf(c);
    return pos < 0 ? 0 : 3 * Math.exp(-pos / 6);
  }

  /**
   * Guesses for what comes next after `text`, best first, each with a score.
   * Known bedside sentences in progress count most, then likely next words, then likely next characters.
   */
  guesses(text: string, n = this.opts.guesses): { text: string; score: number }[] {
    const score = new Map<string, number>();
    const add = (t: string, s: number) => { if (t) score.set(t, Math.max(score.get(t) ?? 0, s)); };
    if (!text) {
      this.starters.slice(0, 8).forEach((w, i) => add(w, 2.4 - 0.15 * i));
    } else {
      // bedside sentences that start with the text so far: their next words, by how many sentences agree
      const matches = this.phrases.filter(p => p.length > text.length && p.startsWith(text));
      if (matches.length) {
        const nextWord = new Map<string, number>();
        for (const p of matches) {
          const rest = p.slice(text.length);
          const w = this.segment(rest)[0];
          nextWord.set(w, (nextWord.get(w) ?? 0) + 1);
          if (rest.length > w.length) add(rest, 2 + 2 / matches.length); // the whole rest, likely once few sentences fit
        }
        for (const [w, c] of nextWord) add(w, 2 + (2 * c) / matches.length);
      }
      // next words after the last word of the text
      for (let L = Math.min(4, text.length); L >= 1; L--) {
        const next = this.wbi.get(text.slice(-L));
        if (next) { next.forEach((w, i) => add(w, 1.9 - 0.1 * i + 0.05 * L)); break; }
      }
      // likely next characters
      const row = this.bi.get(text.slice(-1)) ?? '';
      [...row].slice(0, 6).forEach((c, i) => add(c, 1.4 - 0.12 * i));
    }
    return [...score.entries()].map(([t, s]) => ({ text: t, score: s }))
      .sort((a, b) => b.score - a.score).slice(0, n);
  }

  /**
   * After an initial is chosen: everything that could come next starting with
   * that initial, most likely first, as weighted nodes; rare characters under 更多字.
   */
  nextUnits(code: string, text: string, maxWords = 6): Node[] {
    const last = text.slice(-1);
    const out = new Map<string, Node>();
    const add = (t: string, w: number) => {
      const prev = out.get(t);
      if (prev) { prev.weight = (prev.weight ?? 0) + w; return; }
      out.set(t, { id: `w-${t}`, label: t, action: 'word', data: { text: t, consume: 1 }, weight: w, style: 'glyph' });
    };
    (this.byInit.get(code) ?? []).forEach((c, i) => add(c, (1 / (i + 4)) * (1 + (last ? this.bigramBonus(last, c) : 0))));
    const mass = [...out.values()].reduce((a, n) => a + (n.weight ?? 0), 0);
    // guesses that start with this initial (sentence continuations, next words)
    const g = this.guesses(text, 12).filter(x => this.initialOf(x.text[0]) === code);
    g.forEach(x => add(x.text, mass * 0.12 * x.score));
    // common words starting with this initial that usually follow the last character
    let nw = 0;
    const limit = Math.min(this.words.length, 6000);
    for (let i = 0; i < limit && nw < maxWords; i++) {
      const w = this.words[i];
      if (this.keys[i][0] !== code) continue;
      const hit = last ? this.bigramBonus(last, w[0]) : 0;
      if (last ? hit === 0 : nw >= 3) continue;
      add(w, ((0.08 * mass) / (nw + 2)) * (1 + hit));
      nw++;
    }
    const nodes = [...out.values()].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    const more = this.moreByInit.get(code) ?? [];
    if (more.length) {
      nodes.push({
        id: `more-${code}`, label: '更多字', icon: '🔤', weight: mass * 0.04,
        children: more.map((c, i) => ({ id: `w-${c}`, label: c, action: 'word', data: { text: c, consume: 1 }, weight: 1 / (i + 4), style: 'glyph' as const })),
      });
    }
    return nodes;
  }

  initialNodes(): Node[] {
    return this.initials.map(i => ({
      id: `i-${i.code}`, label: i.py, hint: i.example, action: 'init', data: i.code, style: 'letter' as const,
      ...(this.opts.weightedInitials ? { weight: i.share } : {}),
    }));
  }
}

// ---- spelling state machine, shared by the app and the simulator ----

export interface SpellState { text: string; buf: string }

/**
 * One round. With nothing chosen yet: guesses (and 说完了) next to an
 * "按声母找" folder, sized by how confident the guesses are. After an initial:
 * the characters and words that start with it.
 */
export function spellRoot(sp: Speller, st: SpellState): Node[] {
  if (st.buf) return sp.nextUnits(st.buf[0], st.text);
  const g = sp.guesses(st.text);
  const strong = g.length ? g[0].score : 0;
  // how much of the choice the guesses get: more when a known sentence is under way
  const mass = Math.min(0.85, (strong >= 3 ? 0.65 : strong >= 2.4 ? 0.5 : strong >= 2 ? 0.4 : g.length ? 0.3 : 0) * sp.opts.guessMass);
  const total = g.reduce((a, x) => a + x.score, 0) || 1;
  const nodes: Node[] = g.map(x => ({
    id: `w-${x.text}`, label: x.text, action: 'word', data: { text: x.text, consume: 0 },
    weight: (mass * x.score) / total, style: 'glyph' as const,
  }));
  if (st.text) nodes.push({ id: 'done', label: '说完了', icon: '🔊', action: 'done', weight: 0.12 });
  nodes.push({ id: 'inits', label: '按声母找', icon: '🔡', children: sp.initialNodes(), weight: Math.max(0.3, 1 - mass - (st.text ? 0.12 : 0)) });
  return nodes;
}

/** Apply a chosen leaf. Returns the new state, or 'done' when the sentence is finished. */
export function applyLeaf(st: SpellState, leaf: Node): SpellState | 'done' {
  switch (leaf.action) {
    case 'init': return { text: st.text, buf: st.buf + (leaf.data as string) };
    case 'word': {
      const c = leaf.data as Candidate;
      return { text: st.text + c.text, buf: st.buf.slice(c.consume) };
    }
    case 'done': return 'done';
    default: return st;
  }
}
