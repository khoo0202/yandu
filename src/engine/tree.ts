// Generic "split the options into k groups, pick a group, repeat" engine.
// It knows nothing about eyes, screens or speech: callers pass a group index
// and get back either nothing (still narrowing) or the chosen leaf node.

export type Dir = 'L' | 'R' | 'U';

export interface Node {
  id: string;
  label: string;
  icon?: string;
  /** small text under the label, e.g. an example character for a pinyin initial */
  hint?: string;
  /** sentence spoken when this leaf is chosen */
  say?: string;
  /** a folder: choosing it opens its children */
  children?: Node[];
  /** relative probability, used only by the weighted split */
  weight?: number;
  /** what the app should do when this leaf is chosen */
  action?: string;
  /** free-form payload for the screen that built the node */
  data?: unknown;
  /** how a region should draw this node's group (overrides the default) */
  style?: 'glyph' | 'letter';
}

export type SplitMode = 'even' | 'weighted';

interface Level {
  nodes: Node[];
  lo: number;
  hi: number;
  mode: SplitMode;
}

/** Contiguous split of [lo, hi) into k groups. Returns k+1 boundaries. */
export function splitBounds(nodes: Node[], lo: number, hi: number, k: number, mode: SplitMode): number[] {
  const n = hi - lo;
  if (n <= 0) return Array(k + 1).fill(lo);
  if (n <= k) {
    // one node per group, empty groups at the end
    const b = [lo];
    for (let i = 1; i <= k; i++) b.push(Math.min(lo + i, hi));
    return b;
  }
  if (mode === 'even') {
    // sizes as equal as possible, larger groups first so the layout is stable
    const base = Math.floor(n / k), extra = n % k;
    const b = [lo];
    for (let i = 0; i < k; i++) b.push(b[i] + base + (i < extra ? 1 : 0));
    return b;
  }
  // weighted: cut where the running weight crosses each 1/k of the total
  const w = nodes.slice(lo, hi).map(x => Math.max(1e-9, x.weight ?? 1));
  const total = w.reduce((a, c) => a + c, 0);
  const b = [lo];
  let acc = 0, j = 0;
  for (let g = 1; g < k; g++) {
    const target = (total * g) / k;
    // every remaining group needs at least one node
    const maxIdx = n - (k - g);
    const minIdx = b[g - 1] - lo + 1;
    while (j < maxIdx && j < minIdx) { acc += w[j]; j++; }
    while (j < maxIdx && acc + w[j] / 2 < target) { acc += w[j]; j++; }
    b.push(lo + j);
  }
  b.push(hi);
  return b;
}

/** Weighted split when the nodes carry weights, otherwise even. */
export function autoMode(nodes: Node[]): SplitMode {
  return nodes.some(n => n.weight != null) ? 'weighted' : 'even';
}

/** Does `node` or anything under it have this id? */
export function contains(node: Node, id: string): boolean {
  if (node.id === id) return true;
  return !!node.children?.some(c => contains(c, id));
}

export class Selector {
  private level: Level;
  private history: Level[] = [];
  readonly k: number;

  constructor(nodes: Node[], k: number, mode?: SplitMode) {
    this.k = k;
    this.level = { nodes, lo: 0, hi: nodes.length, mode: mode ?? autoMode(nodes) };
  }

  /** Current groups, one per direction slot (some may be empty). */
  groups(): Node[][] {
    const { nodes, lo, hi, mode } = this.level;
    const b = splitBounds(nodes, lo, hi, this.k, mode);
    const out: Node[][] = [];
    for (let i = 0; i < this.k; i++) out.push(nodes.slice(b[i], b[i + 1]));
    return out;
  }

  /** Number of options still in play at this level. */
  remaining(): number { return this.level.hi - this.level.lo; }

  /** Nodes still in play at this level. */
  current(): Node[] { return this.level.nodes.slice(this.level.lo, this.level.hi); }

  depth(): number { return this.history.length; }

  /**
   * Pick group `gi`. Returns the leaf when one is reached, otherwise null.
   * Choosing a folder opens its children as a new level.
   */
  choose(gi: number): Node | null {
    const { nodes, lo, hi, mode } = this.level;
    const b = splitBounds(nodes, lo, hi, this.k, mode);
    const nlo = b[gi], nhi = b[gi + 1];
    if (nhi <= nlo) return null; // empty group: ignore
    this.history.push({ ...this.level });
    this.level = { nodes, lo: nlo, hi: nhi, mode };
    if (nhi - nlo === 1) {
      const picked = nodes[nlo];
      if (picked.children && picked.children.length) {
        this.level = { nodes: picked.children, lo: 0, hi: picked.children.length, mode: autoMode(picked.children) };
        // a folder with a single child resolves straight away
        if (picked.children.length === 1 && !picked.children[0].children) return picked.children[0];
        return null;
      }
      return picked;
    }
    return null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.level = prev;
    return true;
  }

  /** Index of the group whose subtree holds `id`, or -1. Used by the tutorial and the simulator. */
  groupWith(id: string): number {
    const g = this.groups();
    for (let i = 0; i < g.length; i++) if (g[i].some(n => contains(n, id))) return i;
    return -1;
  }

  /** Index of the group for which `pred` holds on some node (top level of each group only). */
  groupWhere(pred: (n: Node) => boolean): number {
    const g = this.groups();
    for (let i = 0; i < g.length; i++) if (g[i].some(pred)) return i;
    return -1;
  }
}

export const DIRS: Dir[] = ['L', 'R', 'U'];
export function dirsFor(k: number): Dir[] { return DIRS.slice(0, k); }
