import type { Node } from '../engine/tree.ts';

// Spelling by pinyin initials ("简拼"): the patient picks the initial of each
// character, and we offer whole words and phrases that match.

export interface LexiconData {
  init: string[];                 // "code:pinyin:example:share-per-mille"
  chars: Record<string, string>;  // code -> characters, most frequent first
  words: string;                  // comma separated, most frequent first
  keys: string;                   // initial codes per word, same order
  bi: string;                     // "A + likely next chars", space separated
}

export interface Initial { code: string; py: string; example: string; share: number }

export interface Candidate { text: string; consume: number }

// Example characters a bedside user is likely to recognise, one per initial.
const EXAMPLES: Record<string, string> = {
  b: '不', p: '怕', m: '妈', f: '饭', d: '大', t: '疼', n: '你', l: '来', g: '哥', k: '看', h: '喝',
  j: '家', q: '去', x: '想', Z: '这', C: '吃', S: '水', r: '人', z: '在', c: '菜', s: '睡', y: '要', w: '我', _: '爱',
};

const PUNCT = /[，。！？、,.!?\s]/g;

// Characters common in everyday speech but under-weighted in a news-heavy corpus.
const SPOKEN_EXTRA = '我你他她们吗吧呢啊呀哦嗯没别想要去来回给拿帮叫看听说吃喝睡走坐躺疼痛冷热饿渴累好坏快慢多少点儿个这那哪谁什么怎样今明昨天早晚上下午家医院护药水饭菜汤粥灯门床被子手脚头眼耳嘴妈爸哥姐弟妹儿女孙爷奶外公婆朋友电话视机';

export interface SpellOptions {
  /** shape the initials tree by how common each initial is (still a fixed tree) */
  weightedInitials?: boolean;
}

export class Speller {
  readonly initials: Initial[];
  readonly opts: Required<SpellOptions>;
  private charInit = new Map<string, string>();
  private charRank = new Map<string, number>();
  private byInit = new Map<string, string[]>();
  private words: string[];
  private keys: string[];
  private bi = new Map<string, string>();
  private phrases: { text: string; key: string }[] = [];
  /** how often each character appears in the bedside phrases (spoken-language prior) */
  private spoken = new Map<string, number>();

  constructor(data: LexiconData, phrases: string[] = [], opts: SpellOptions = {}) {
    this.opts = { weightedInitials: true, ...opts };
    this.initials = data.init.map(s => {
      const [code, py, ex, share] = s.split(':');
      return { code, py, example: EXAMPLES[code] ?? ex ?? '', share: Number(share) || 1 };
    });
    for (const [code, cs] of Object.entries(data.chars)) {
      const list = [...cs];
      this.byInit.set(code, list);
      list.forEach((c, i) => { this.charInit.set(c, code); this.charRank.set(c, i); });
    }
    this.words = data.words.split(',');
    this.keys = data.keys.split(',');
    for (const row of data.bi.split(' ')) if (row) this.bi.set(row[0], row.slice(1));
    const seen = new Set<string>();
    for (const p of phrases) {
      const text = p.replace(PUNCT, '');
      if (!text || seen.has(text)) continue;
      seen.add(text);
      this.phrases.push({ text, key: this.keyOf(text) });
      for (const c of text) this.spoken.set(c, (this.spoken.get(c) ?? 0) + 1);
    }
    for (const c of SPOKEN_EXTRA) this.spoken.set(c, (this.spoken.get(c) ?? 0) + 2);
  }

  /** Initial code of a character, or '' if unknown. */
  initialOf(c: string): string { return this.charInit.get(c) ?? ''; }

  /** Initial codes of a text; characters we don't know are skipped. */
  keyOf(text: string): string {
    let k = '';
    for (const c of text) { const i = this.charInit.get(c); if (i) k += i; }
    return k;
  }

  pinyinOf(code: string): string { return this.initials.find(i => i.code === code)?.py ?? code; }

  private bigramBonus(last: string, c: string): number {
    const row = this.bi.get(last);
    if (!row) return 0;
    const pos = row.indexOf(c);
    return pos < 0 ? 0 : 3 * Math.exp(-pos / 6);
  }

  /**
   * After an initial is chosen: everything that could come next starting with
   * that initial, most likely first, as weighted nodes. Phrase continuations,
   * then words, then single characters.
   */
  nextUnits(code: string, text: string, maxWords = 8): Node[] {
    const last = text.slice(-1);
    const out = new Map<string, Node>();
    const add = (t: string, w: number) => {
      const prev = out.get(t);
      if (prev) { prev.weight = (prev.weight ?? 0) + w; return; }
      out.set(t, { id: `w-${t}`, label: t, action: 'word', data: { text: t, consume: 1 }, weight: w, style: 'glyph' });
    };
    // single characters: corpus frequency, spoken-language boost, what usually follows `last`
    const cs = this.byInit.get(code) ?? [];
    cs.forEach((c, i) => {
      const spoken = this.spoken.get(c) ?? 0;
      add(c, (1 / (i + 5)) * (1 + (last ? this.bigramBonus(last, c) : 0)) * (1 + Math.min(3, spoken / 2)));
    });
    const charMass = [...out.values()].reduce((a, n) => a + (n.weight ?? 0), 0);
    // known phrases already under way: together at most ~35% of the choice
    const conts = this.phrases.filter(p => text && p.text.length > text.length + 1 && p.text.startsWith(text) && this.initialOf(p.text[text.length]) === code);
    for (const p of conts) {
      add(p.text.slice(text.length), (0.35 * charMass) / Math.max(2, conts.length));
      // the first character of a continuation is likely on its own too
      add(p.text[text.length], (0.15 * charMass) / Math.max(2, conts.length));
    }
    // common words starting with this initial, mostly ones that follow `last`
    let nw = 0;
    // only the most common words, so rare names and jargon don't clutter the screen
    const limit = Math.min(this.words.length, 8000);
    for (let i = 0; i < limit && nw < maxWords; i++) {
      const w = this.words[i];
      if (w.length < 2 || this.keys[i][0] !== code) continue;
      const hit = last ? this.bigramBonus(last, w[0]) : 0;
      // mid-sentence, only words that usually follow the previous character
      if (last ? hit === 0 : nw >= 4) continue;
      add(w, ((0.12 * charMass) / (nw + 2)) * (1 + hit));
      nw++;
    }
    return [...out.values()].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
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
 * Two stages per unit: choose an initial (a fixed tree, so letters keep their
 * place), then pick a character, word or phrase continuation starting with it
 * (a tree shaped by likelihood). `buf` holds the chosen initial between stages.
 */
export function spellRoot(sp: Speller, st: SpellState): Node[] {
  if (st.buf) return sp.nextUnits(st.buf[0], st.text);
  const inits = sp.initialNodes();
  if (st.text) inits.push({ id: 'done', label: '说完了', icon: '🔊', action: 'done', weight: 60 });
  return inits;
}

/** Apply a chosen leaf. Returns the new state, or 'done' when the sentence is finished. */
export function applyLeaf(st: SpellState, leaf: Node): SpellState | 'done' {
  switch (leaf.action) {
    case 'init': return { text: st.text, buf: st.buf + (leaf.data as string) };
    case 'word': {
      const c = leaf.data as Candidate;
      return { text: st.text + c.text, buf: st.buf.slice(c.consume) };
    }
    case 'char': return { text: st.text + (leaf.data as string), buf: st.buf.slice(1) };
    case 'done': return 'done';
    default: return st;
  }
}
