import type { Node } from '../engine/tree.ts';

export interface HomeContext {
  sentence: string;      // spelled sentence waiting to be spoken
  lastSpoken: string;    // for "say it again"
  board: Node[];
  pinyin: boolean;       // patient can use the spelling mode
}

/**
 * Home screen tree. Left is always the needs board (the fast path);
 * right holds spelling and the less common commands.
 */
export function buildHome(ctx: HomeContext): Node[] {
  const more: Node[] = [];
  if (ctx.pinyin) more.push({ id: 'spell', label: ctx.sentence ? '继续拼' : '拼字', icon: '✏️', action: 'spell' });
  if (ctx.sentence) more.push({ id: 'clear', label: '清空句子', icon: '🧹', action: 'clear' });
  if (ctx.lastSpoken) more.push({ id: 'repeat', label: '再说一次', icon: '🔁', action: 'repeat' });
  more.push({ id: 'rest', label: '休息', icon: '🌙', action: 'rest' });

  const board: Node = { id: 'board', label: '常用需求', icon: '📋', children: ctx.board };
  const moreNode: Node = { id: 'more', label: ctx.pinyin ? '拼字和更多' : '更多', icon: '➕', children: more };

  if (ctx.sentence) {
    return [{ id: 'speak', label: '说出来', icon: '🔊', action: 'speak' }, board, moreNode];
  }
  return [board, moreNode];
}
