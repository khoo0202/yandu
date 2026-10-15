// Drawing the main screen: sentence, prompt, the choice regions, toasts.

import type { Dir, Node } from '../engine/tree.ts';

export interface RegionSpec {
  nodes?: Node[];
  /** replace the node rendering with fixed content (verdicts, tutorial objects) */
  big?: { icon?: string; label: string; sub?: string };
  glow?: boolean;
  dim?: boolean;
}

export type Regions = Partial<Record<Dir, RegionSpec>>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const ARROW: Record<Dir, string> = { L: '← 看左边', R: '看右边 →', U: '↑ 看上面' };

/** Short spoken/printed summary of a group, e.g. "身体不舒服、护理". */
export function summarize(nodes: Node[], max = 4): string {
  const names = nodes.slice(0, max).map(n => n.label);
  return names.join('、') + (nodes.length > max ? ` 等 ${nodes.length} 个` : '');
}

function folderPreview(n: Node): string {
  return n.children ? summarize(n.children, 4) : '';
}

function nodesHTML(nodes: Node[]): string {
  const n = nodes.length;
  if (n === 0) return '';
  const style = nodes[0].style;
  if (n === 1) {
    const x = nodes[0];
    const sub = x.children ? folderPreview(x) : x.hint ? `例：${x.hint}` : '';
    const cls = style === 'letter' ? 'one letter' : style === 'glyph' ? 'one glyph' : 'one';
    return `<div class="${cls}">${x.icon ? `<div class="ic">${x.icon}</div>` : ''}<div class="lb">${esc(x.label)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
  }
  if (style === 'letter') {
    return `<div class="letters n${Math.min(n, 13)}">${nodes.map(x => `<div class="lt"><b>${esc(x.label)}</b><i>${esc(x.hint ?? '')}</i></div>`).join('')}</div>`;
  }
  if (style === 'glyph') {
    // single characters first (most likely first), then at most 6 words, so the side is easy to scan
    const chars = nodes.filter(x => x.label.length === 1);
    const words = nodes.filter(x => x.label.length > 1);
    const show = [...chars.slice(0, 24), ...words.slice(0, chars.length > 8 ? 3 : 6)];
    const more = n > show.length ? `<div class="more">还有 ${n - show.length} 个</div>` : '';
    const size = n <= 4 ? 'g-l' : n <= 12 ? 'g-m' : 'g-s';
    return `<div class="glyphs ${size}">${show.map(x => `<span class="${x.label.length > 1 ? 'wd' : ''}">${esc(x.label)}</span>`).join('')}</div>${more}`;
  }
  if (n <= 4) {
    return `<div class="optrows">${nodes.map(x => `<div class="optrow">${x.icon ? `<span class="ic">${x.icon}</span>` : ''}<span class="lb">${esc(x.label)}</span>${x.children ? `<span class="pv">${esc(folderPreview(x))}</span>` : ''}</div>`).join('')}</div>`;
  }
  return `<div class="cells">${nodes.map(x => `<div class="cell">${x.icon ? `<span class="ic">${x.icon}</span>` : ''}<span class="lb">${esc(x.label)}</span></div>`).join('')}</div>`;
}

export function renderRegions(regions: Regions, active: Dir[]) {
  const stage = $('stage');
  stage.classList.toggle('three', active.includes('U'));
  for (const d of ['L', 'R', 'U'] as Dir[]) {
    const el = stage.querySelector<HTMLElement>(`.region[data-dir="${d}"]`)!;
    const spec = regions[d];
    const on = active.includes(d);
    el.hidden = !on;
    if (!on) continue;
    const empty = !spec || (!spec.big && !(spec.nodes && spec.nodes.length));
    el.classList.toggle('empty', empty);
    el.classList.toggle('glow', !!spec?.glow);
    el.classList.toggle('dim', !!spec?.dim);
    const content = el.querySelector<HTMLElement>('.content')!;
    if (empty) { content.innerHTML = ''; continue; }
    const body = spec!.big
      ? `<div class="one">${spec!.big.icon ? `<div class="ic">${spec!.big.icon}</div>` : ''}<div class="lb">${esc(spec!.big.label)}</div>${spec!.big.sub ? `<div class="sub">${esc(spec!.big.sub)}</div>` : ''}</div>`
      : nodesHTML(spec!.nodes!);
    content.innerHTML = `<div class="arrow">${ARROW[d]}</div>${body}`;
  }
}

export function setProgress(dir: Dir | null, p: number) {
  for (const d of ['L', 'R', 'U'] as Dir[]) {
    const f = document.querySelector<HTMLElement>(`.region[data-dir="${d}"] .fill`);
    if (f) f.style.transform = `scaleY(${d === dir ? Math.min(1, p) : 0})`;
  }
}

export function flash(dir: Dir) {
  const el = document.querySelector<HTMLElement>(`.region[data-dir="${dir}"]`);
  if (!el) return;
  el.classList.remove('hit');
  void el.offsetWidth;
  el.classList.add('hit');
}

export function setSentence(text: string, placeholder: string) {
  const el = $('sentence');
  el.textContent = text || placeholder;
  el.classList.toggle('empty', !text);
}

export function setPrompt(text: string) { $('prompt').textContent = text; }

let toastTimer = 0;
export function toast(text: string, ms = 2200) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

export function setBackMeter(p: number) {
  const el = $('backMeter');
  el.style.setProperty('--p', String(p));
  el.classList.toggle('on', p > 0);
}

export function setFaceState(text: string, warn: boolean) {
  const el = $('faceState');
  el.textContent = text;
  el.classList.toggle('warn', warn);
}

export function setNoFace(on: boolean) { document.body.classList.toggle('noface', on); }

export function setLegend(backMs: number, call: 'triple' | 'up' | 'off') {
  const g = document.querySelectorAll<HTMLElement>('#legend .g');
  g[0].textContent = `😌 闭眼 ${(backMs / 1000).toFixed(1).replace(/\.0$/, '')} 秒 = 返回一步`;
  g[1].hidden = call === 'off';
  g[1].textContent = call === 'up' ? '⬆️ 往上看 2 秒 = 叫人' : '😉 眨眼 3 下 = 叫人';
}
