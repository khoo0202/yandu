// Simulated user: counts how many looks (group choices) each task takes.
// Run: npm run sim            (2-way)
//      npm run sim -- 3       (3-way)
import { readFileSync } from 'node:fs';
import { Selector, contains, type Node } from '../src/engine/tree.ts';
import { buildBoard, boardSentences, CARE_PHRASES } from '../src/data/board.ts';
import { BEDSIDE_PHRASES } from '../src/data/phrases.ts';
import { buildHome } from '../src/data/home.ts';
import { Speller, spellRoot, applyLeaf, type SpellState, type LexiconData } from '../src/lang/speller.ts';

const K = Number(process.argv[2] ?? 2);
const lex = JSON.parse(readFileSync(new URL('../public/data/lexicon.json', import.meta.url), 'utf8')) as LexiconData;
const board = buildBoard([]);
const OPTS = JSON.parse(process.env.SIM_OPTS ?? '{}');
const PHRASES = [...boardSentences(board), ...CARE_PHRASES, ...BEDSIDE_PHRASES];
const sp = new Speller(lex, PHRASES, OPTS);

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
      const walk = (ns: Node[]) => ns.forEach(n => { if (n.action === 'word') words.push((n.data as { text: string }).text); if (n.children && n.id !== 'inits') walk(n.children); });
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

// free sentences through spelling: ones in the bedside list, and new ones it has never seen
const KNOWN = ['我想回家', '今天谁来看我', '帮我翻身', '我想见孙子', '把电视关掉'];
const NEW = ['明天叫阿明来', '我想吃西瓜', '帮我打电话给女儿', '我的眼镜在哪里', '电视声音太大了', '我昨晚没睡好',
  '我的背好痛', '帮我把枕头拿高一点', '今天几号了', '我不想吃饭', '给我一点水', '你今天会来吗', '我胸口很闷',
  '帮我擦一下脸', '我想喝一点汤', '帮我把灯调暗', '我的手好麻', '今天有人来吗', '我想睡觉了', '外面下雨了吗'];
const known = new Set(PHRASES.map(p => p.replace(/[^\u4e00-\u9fff]/g, '')));
for (const [name, list] of [['in the bedside list', KNOWN], ['never seen', NEW]] as const) {
  let tot = 0, chars = 0;
  for (const s of list) {
    const n = navigate(home(), 'spell') + spell(s) + 1;
    tot += n; chars += s.length;
    if (process.env.SIM_VERBOSE) console.log(`  ${known.has(s) ? '*' : ' '} ${s.padEnd(9, '　')} ${n} looks (${(n / s.length).toFixed(1)}/char)`);
  }
  console.log(`spelling, ${name}: ${(tot / chars).toFixed(2)} looks per character, ${(tot / list.length).toFixed(1)} per sentence`);
}
void contains;
