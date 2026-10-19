// Drawing the main screen: sentence, prompt, the choice regions, toasts.

import type { Dir, Node } from '../engine/tree.ts';
import { settings } from '../store.ts';

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

const ARROW_ON: Record<Dir, string> = { L: '← 看左边', R: '看右边 →', U: '↑ 看上面' };
const ARROW_OUT: Record<Dir, string> = { L: '← 往外看，选这边', R: '选这边，往外看 →', U: '↑ 往上外看，选这边' };
const ARROW_FLICK: Record<Dir, string> = { L: '← 往外看一下，选这边', R: '选这边，往外看一下 →', U: '↑ 往上外看一下，选这边' };
export function arrowText(d: Dir): string {
  if (settings.selectStyle !== 'outside') return ARROW_ON[d];
  return (settings.trigger === 'flick' ? ARROW_FLICK : ARROW_OUT)[d];
}

/** Short spoken/printed summary of a group, e.g. "身体不舒服、护理". */
export function summarize(nodes: Node[], max = 4): string {
  const names = nodes.slice(0, max).map(n => n.label);
  return names.join('、') + (nodes.length > max ? ` 等 ${nodes.length} 个` : '');
}

function g0(total: number, shown: number): string {
  return total > shown ? `<div class="more">还有 ${total - shown} 个</div>` : '';
}

function folderPreview(n: Node): string {
  return n.children ? summarize(n.children, 4) : '';
}

function nodesHTML(nodes: Node[], maxGlyphs = 24): string {
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
  if (style === 'glyph' || nodes.some(x => x.style === 'glyph')) {
    // commands and folders (说完了, 按声母找, 更多字) as chips; then single characters, then a few words
    const extra = nodes.filter(x => x.style !== 'glyph');
    const chips = extra.map(x => `<div class="chip">${x.icon ? `<span>${x.icon}</span>` : ''}${esc(x.label)}${x.children ? `<small>${esc(summarize(x.children, 6))}</small>` : ''}</div>`).join('');
    const glyphs = nodes.filter(x => x.style === 'glyph');
    const chars = glyphs.filter(x => x.label.length === 1);
    const words = glyphs.filter(x => x.label.length > 1);
    const show = [...chars.slice(0, maxGlyphs), ...words.slice(0, chars.length > 8 ? Math.min(3, Math.ceil(maxGlyphs / 6)) : 6)];
    const more = g0(glyphs.length, show.length);
    const g = glyphs.length;
    const size = g <= 4 ? 'g-l' : g <= 12 ? 'g-m' : 'g-s';
    const body = show.length ? `<div class="glyphs ${size}">${show.map(x => `<span class="${x.label.length > 1 ? 'wd' : ''}">${esc(x.label)}</span>`).join('')}</div>` : '';
    return `${body}${more}${chips ? `<div class="chips">${chips}</div>` : ''}`;
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
      : nodesHTML(spec!.nodes!, d === 'U' ? 12 : 24);
    content.innerHTML = `<div class="arrow">${arrowText(d)}</div>${body}`;
  }
  requestAnimationFrame(fitRegions);
}

/** Shrink a region's content until it fits, so nothing is cut off (the top band is short in 3-way). */
export function fitRegions() {
  document.querySelectorAll<HTMLElement>('.region:not([hidden])').forEach(el => {
    const content = el.querySelector<HTMLElement>('.content');
    if (!content) return;
    content.style.zoom = '1';
    const room = el.clientHeight - 16, roomW = el.clientWidth - 12;
    for (let z = 1; z > 0.6; z -= 0.05) {
      content.style.zoom = String(z);
      const r = content.getBoundingClientRect();
      if (r.height <= room && r.width <= roomW + 1) break;
    }
  });
}

/** Make the sentence fit its line: smaller type first; if still too long, show its end. */
function fitSentence() {
  const el = $('sentence');
  el.style.fontSize = '';
  const full = el.dataset.full ?? el.textContent ?? '';
  el.textContent = full;
  if (el.classList.contains('empty')) return;
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollHeight > el.clientHeight + 2 && size > 20) {
    size -= 3;
    el.style.fontSize = `${size}px`;
  }
  // still too long: keep the newest part visible
  let cut = 0;
  while (el.scrollHeight > el.clientHeight + 2 && cut < full.length - 4) {
    cut += 2;
    el.textContent = '…' + full.slice(cut);
  }
}
window.addEventListener('resize', () => { fitRegions(); fitSentence(); });

export function setProgress(dir: Dir | null, p: number) {
  for (const d of ['L', 'R', 'U'] as Dir[]) {
    const f = document.querySelector<HTMLElement>(`.region[data-dir="${d}"] .fill`);
    if (f) f.style.transform = `scaleY(${d === dir ? Math.min(1, p) : 0})`;
    const e = document.getElementById(`edge${d}`);
    if (e) { e.classList.toggle('on', d === dir && p > 0); e.style.setProperty('--p', String(d === dir ? Math.min(1, p) : 0)); }
  }
}

/** Edge markers that show where to look (past the phone's edge) in "outside" mode. */
export function setEdges(active: Dir[]) {
  const out = settings.selectStyle === 'outside';
  document.body.classList.toggle('outside', out);
  for (const d of ['L', 'R', 'U'] as Dir[]) {
    const e = document.getElementById(`edge${d}`);
    if (e) e.hidden = !out || !active.includes(d);
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
  el.dataset.full = text || placeholder;
  el.textContent = text || placeholder;
  el.classList.toggle('empty', !text);
  requestAnimationFrame(fitSentence);
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
  const how = document.getElementById('legendHow');
  if (how) {
    how.hidden = settings.selectStyle !== 'outside';
    how.textContent = settings.trigger === 'flick'
      ? '👀 找的时候随便看；要选哪边，眼睛往那边手机外面看一下就选中，再看回屏幕'
      : '👀 找的时候随便看；要选哪边，眼睛就往那边的手机外面看';
  }
  g[0].textContent = `😌 闭眼 ${(backMs / 1000).toFixed(1).replace(/\.0$/, '')} 秒 = 返回一步`;
  g[1].hidden = call === 'off';
  g[1].textContent = call === 'up' ? '⬆️ 往上看 2 秒 = 叫人' : '😉 眨眼 3 下 = 叫人';
}
