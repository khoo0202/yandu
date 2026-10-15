// Simulated user: counts how many looks (group choices) each task takes.
// Run: npm run sim            (2-way)
//      npm run sim -- 3       (3-way)
import { readFileSync } from 'node:fs';
import { Selector, contains, type Node } from '../src/engine/tree.ts';
import { buildBoard, boardSentences, CARE_PHRASES } from '../src/data/board.ts';
import { buildHome } from '../src/data/home.ts';
import { Speller, spellRoot, applyLeaf, type SpellState, type LexiconData } from '../src/lang/speller.ts';

const K = Number(process.argv[2] ?? 2);
const lex = JSON.parse(readFileSync(new URL('../public/data/lexicon.json', import.meta.url), 'utf8')) as LexiconData;
const board = buildBoard([]);
const OPTS = JSON.parse(process.env.SIM_OPTS ?? '{}');
const sp = new Speller(lex, [...boardSentences(board), ...CARE_PHRASES], OPTS);

/** Walk a tree until the leaf `id` is chosen; returns looks used. */
function navigate(nodes: Node[], id: string): number {
  const sel = new Selector(nodes, K);
  let looks = 0;
  for (;;) {
    const g = sel.groupWith(id);
    if (g < 0) throw new Error(`cannot reach ${id}`);
    looks++;
    const leaf = sel.choose(g);
    if (leaf) {
      if (leaf.id !== id) throw new Error(`reached ${leaf.id}, wanted ${id}`);
      return looks;
    }
  }
}

/** Spell `target` with the initials mode, then finish. Returns looks. */
function spell(target: string): number {
  let st: SpellState = { text: '', buf: '' };
  let looks = 0;
  for (let guard = 0; guard < 200; guard++) {
    const root = spellRoot(sp, st);
    const rest = target.slice(st.text.length);
    let want: string;
    if (!rest) want = 'done';
    else {
      // longest offered word that continues the target
      const words: string[] = [];
      const walk = (ns: Node[]) => ns.forEach(n => { if (n.action === 'word' || n.action === 'char') words.push(n.action === 'char' ? (n.data as string) : (n.data as { text: string }).text); if (n.children && n.id === 'cands') walk(n.children); });
      walk(root);
      const fit = words.filter(w => rest.startsWith(w)).sort((a, b) => b.length - a.length)[0];
      if (fit) want = `w-${fit}`;
      else want = `i-${sp.initialOf(rest[0])}`;
    }
    // navigate within this root to `want`
    const sel = new Selector(root, K);
    let leaf: Node | null = null;
    while (!leaf) {
      const g = sel.groupWith(want);
      if (g < 0) throw new Error(`spell: cannot reach ${want} (text=${st.text} buf=${st.buf})`);
      looks++;
      leaf = sel.choose(g);
    }
    const next = applyLeaf(st, leaf);
    if (next === 'done') return looks;
    st = next;
  }
  throw new Error('spell: too many steps');
}

const home = (sentence = '') => buildHome({ sentence, lastSpoken: '', board, pinyin: true });
const T2 = navigate(home(), 'water');
const T3 = navigate(home(), 'pain-belly');
const T4 = navigate(home(), 'spell') + spell('明天叫阿明来') + 1; // +1 = confirm "说出来"

console.log(`${K}-way ${JSON.stringify(OPTS)}`);
console.log(`T2 我想喝水     ${T2} looks`);
console.log(`T3 我肚子疼     ${T3} looks`);
console.log(`T4 明天叫阿明来 ${T4} looks`);

// every board leaf
const leaves: Node[] = [];
const walk = (ns: Node[]) => ns.forEach(n => (n.children ? walk(n.children) : leaves.push(n)));
walk(board);
const bl = leaves.map(l => navigate(home(), l.id));
console.log(`board: ${leaves.length} items, mean ${(bl.reduce((a, b) => a + b, 0) / bl.length).toFixed(1)}, max ${Math.max(...bl)}`);

// free sentences through spelling
const SENTENCES = ['我想回家', '今天谁来看我', '明天叫阿明来', '我想吃西瓜', '帮我打电话给女儿', '我的眼镜在哪里', '把灯关掉', '我想见孙子', '电视声音太大了', '我昨晚没睡好'];
let tot = 0, chars = 0;
for (const s of SENTENCES) {
  const n = navigate(home(), 'spell') + spell(s) + 1;
  tot += n; chars += s.length;
  console.log(`  spell ${s.padEnd(8, '　')} ${n} looks (${(n / s.length).toFixed(1)}/char)`);
}
console.log(`spelling: ${(tot / chars).toFixed(2)} looks per character (v1: about 11.8)`);
void contains;
