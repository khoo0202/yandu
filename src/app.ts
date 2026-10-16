// Screen stack and the screens the patient drives with their eyes.

import { Selector, dirsFor, type Dir, type Node } from './engine/tree.ts';
import { buildBoard, boardSentences, CARE_PHRASES } from './data/board.ts';
import { buildHome } from './data/home.ts';
import { Speller, spellRoot, applyLeaf, type SpellState, type LexiconData } from './lang/speller.ts';
import { settings, profile, saveSettings } from './store.ts';
import { say, earcon, startAlarm, stopAlarm, stopSpeaking } from './speech.ts';
import { log } from './metrics.ts';
import type { GazeEngine } from './gaze/engine.ts';
import {
  renderRegions, setPrompt, setSentence, toast, flash, setProgress, summarize, setLegend, setEdges, type Regions,
} from './ui/view.ts';

export interface Screen {
  id: string;
  dirs(): Dir[];
  render(): void;
  select(dir: Dir): void;
  /** handle "go back one step"; return false to let the app close this screen */
  back(): boolean;
  enter?(): void;
  exit?(): void;
  /** text read out when "read the options" is on */
  spoken?(): string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class App {
  stack: Screen[] = [];
  sentence = '';
  lastSpoken = '';
  board: Node[] = buildBoard(profile.family);
  speller: Speller | null = null;
  gaze: GazeEngine | null = null;
  /** true while a modal (setup, settings, call) owns the screen */
  modal = false;
  /** listeners used by the setup wizard's action test */
  tap: { select?: (d: Dir) => void; back?: () => void; call?: () => void } | null = null;
  private undoTimes: number[] = [];
  private callOn = false;
  /** start of the current stretch of use, for the eye-rest reminder */
  private useSince = 0;
  private lastSelectAt = 0;

  async loadLexicon() {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/lexicon.json`);
      const data = await r.json() as LexiconData;
      this.speller = new Speller(data, [...boardSentences(this.board), ...CARE_PHRASES]);
    } catch { this.speller = null; }
  }

  top(): Screen | undefined { return this.stack[this.stack.length - 1]; }

  push(s: Screen) {
    this.top()?.exit?.();
    this.stack.push(s);
    s.enter?.();
    this.refresh();
  }

  pop(): boolean {
    if (this.stack.length <= 1) return false;
    this.stack.pop()?.exit?.();
    this.top()?.enter?.();
    this.refresh();
    return true;
  }

  /** Replace the whole stack with one screen (used by the tutorial). */
  only(s: Screen) {
    while (this.stack.length) this.stack.pop()?.exit?.();
    this.stack.push(s);
    s.enter?.();
    this.refresh();
  }

  /** Back to a fresh home screen. */
  home() {
    while (this.stack.length) this.stack.pop()?.exit?.();
    this.board = buildBoard(profile.family);
    const h = homeScreen(this);
    this.stack.push(h);
    h.enter?.();
    this.refresh();
  }

  refresh() {
    const s = this.top();
    if (!s) return;
    const pending = s instanceof SpellScreen ? s.pendingLabel() : '';
    setSentence(this.sentence + pending, '');
    if (this.gaze) { this.gaze.dirs = s.dirs(); this.gaze.cooldown(350); }
    setProgress(null, 0);
    setLegend(settings.backMs, settings.callGesture);
    setEdges(s.dirs());
    s.render();
    if (settings.readOptions && !this.modal && s.spoken) void say(s.spoken());
  }

  // ---- input from eyes, touch or keyboard ----

  onSelect(dir: Dir) {
    if (this.tap?.select) { this.tap.select(dir); return; }
    if (this.modal || this.callOn) return;
    const s = this.top();
    if (!s || !s.dirs().includes(dir)) return;
    log('select', { screen: s.id, dir });
    this.restReminder();
    earcon(dir);
    flash(dir);
    s.select(dir);
    if (this.top() === s) this.refresh();
  }

  onBack() {
    if (this.tap?.back) { this.tap.back(); return; }
    if (this.modal || this.callOn) return;
    const s = this.top();
    if (!s) return;
    log('undo', { screen: s.id });
    earcon('back');
    if (!s.id.startsWith('tut-')) this.noteUndo();
    if (s.back()) { this.refresh(); toast('已退回一步'); return; }
    if (this.stack.length > 1) {
      this.stack.pop()?.exit?.();
      // the step that opened the closed screen is undone too
      const below = this.top()!;
      below.enter?.();
      below.back();
      this.refresh();
      toast('已退回一步');
    } else toast('已经在最开始了');
  }

  onCall() {
    if (this.tap?.call) { this.tap.call(); return; }
    if (this.callOn) return;
    this.callOn = true;
    log('call');
    $('callOverlay').hidden = false;
    startAlarm();
    void say('我需要人帮忙', true);
  }

  endCall() {
    this.callOn = false;
    $('callOverlay').hidden = true;
    stopAlarm();
    stopSpeaking();
    this.gaze?.cooldown(800);
  }

  /** After 20 minutes of steady use, suggest resting the eyes (a 5-minute gap resets the clock). */
  private restReminder() {
    const now = Date.now();
    if (!this.useSince || now - this.lastSelectAt > 5 * 60_000) this.useSince = now;
    this.lastSelectAt = now;
    if (now - this.useSince > 20 * 60_000) {
      this.useSince = now;
      setTimeout(() => {
        toast('用了 20 分钟了，让眼睛休息一下吧：可以闭眼或看远处', 5000);
        void say('用了二十分钟了，眼睛休息一下吧', false);
      }, 1200);
    }
  }

  /** Two undos within 20 s: the patient is probably being rushed. Hold a bit longer. */
  private noteUndo() {
    const now = Date.now();
    this.undoTimes = this.undoTimes.filter(t => now - t < 20000);
    this.undoTimes.push(now);
    if (settings.autoSlow && settings.trigger !== 'flick' && this.undoTimes.length >= 2 && settings.dwellMs < 2000) {
      settings.dwellMs += 200;
      settings.glanceMs = Math.min(1000, settings.glanceMs + 100);
      saveSettings();
      this.undoTimes = [];
      setTimeout(() => toast(`已经调慢：看住 ${(settings.dwellMs / 1000).toFixed(1)} 秒才算选择`, 3000), 900);
    }
  }

  /** Read a sentence aloud and remember it. */
  async speak(text: string) {
    log('speak', { detail: text });
    this.lastSpoken = text;
    await say(text, true);
  }
}

// ---------------- screens ----------------

const ways = (): Dir[] => dirsFor(settings.ways);

function regionsFromGroups(groups: Node[][], dirs: Dir[], glow = -1): Regions {
  const r: Regions = {};
  dirs.forEach((d, i) => (r[d] = { nodes: groups[i] ?? [], glow: i === glow }));
  return r;
}

function spokenGroups(groups: Node[][], dirs: Dir[]): string {
  const name: Record<Dir, string> = { L: '左边', R: '右边', U: '上面' };
  return dirs.map((d, i) => (groups[i]?.length ? `${name[d]}：${summarize(groups[i], 3)}` : '')).filter(Boolean).join('。');
}

/** A tree of choices (home, the needs board). */
export class ChoiceScreen implements Screen {
  sel: Selector;
  enter?: () => void;
  constructor(
    public id: string,
    nodes: Node[],
    private onLeaf: (n: Node) => void,
    private opts: { prompt?: (depth: number) => string; guide?: string; onWrong?: () => void } = {},
  ) {
    this.sel = new Selector(nodes, settings.ways);
  }
  dirs() { return ways(); }
  render() {
    const g = this.sel.groups();
    const glow = this.opts.guide ? this.sel.groupWith(this.opts.guide) : -1;
    renderRegions(regionsFromGroups(g, this.dirs(), glow), this.dirs());
    setPrompt(this.opts.guide ? '请选发亮的那一边' : this.opts.prompt?.(this.sel.depth()) ?? '你想说的在哪一边？');
  }
  select(dir: Dir) {
    const gi = this.dirs().indexOf(dir);
    if (this.opts.guide && gi !== this.sel.groupWith(this.opts.guide)) { this.opts.onWrong?.(); return; }
    const leaf = this.sel.choose(gi);
    if (leaf) this.onLeaf(leaf);
  }
  back() { return this.sel.undo(); }
  spoken() { return spokenGroups(this.sel.groups(), this.dirs()); }
}

export function homeScreen(app: App): ChoiceScreen {
  const nodes = buildHome({ sentence: app.sentence, lastSpoken: app.lastSpoken, board: app.board, pinyin: profile.pinyin && !!app.speller });
  return new ChoiceScreen('home', nodes, leaf => handleLeaf(app, leaf), {
    prompt: d => (d === 0 ? '想说什么？常用的话在左边' : '你想说的在哪一边？'),
  });
}

export function handleLeaf(app: App, leaf: Node) {
  if (leaf.say) { app.push(new PreviewScreen(app, leaf.say)); return; }
  switch (leaf.action) {
    case 'spell': app.push(new SpellScreen(app)); break;
    case 'speak': app.push(new ConfirmScreen(app)); break;
    case 'clear': app.sentence = ''; toast('句子已清空'); app.home(); break;
    case 'repeat': void app.speak(app.lastSpoken); app.home(); break;
    case 'rest': app.push(new RestScreen(app)); break;
  }
}

/** Shows a board sentence for a moment, then reads it out. Closing the eyes cancels. */
export class PreviewScreen implements Screen {
  id = 'preview';
  private timer = 0;
  private done = false;
  constructor(private app: App, private text: string, private after?: () => void) {}
  dirs(): Dir[] { return []; }
  enter() {
    this.timer = window.setTimeout(async () => {
      this.done = true;
      await this.app.speak(this.text);
      setTimeout(() => {
        if (this.app.top() !== this) return;
        if (this.after) this.after(); else this.app.home();
      }, 700);
    }, settings.speakPreviewMs);
  }
  exit() { clearTimeout(this.timer); $('bigmsg').hidden = true; }
  render() {
    renderRegions({}, []);
    const el = $('bigmsg');
    el.hidden = false;
    el.innerHTML = `<div class="say">${this.text.replace(/[&<>]/g, '')}</div><div class="bar"><i style="animation-duration:${settings.speakPreviewMs}ms"></i></div><div class="hint">${this.done ? '' : '马上读出 · 闭眼可以取消'}</div>`;
    setPrompt('');
  }
  select() { /* nothing to choose */ }
  back() { clearTimeout(this.timer); return false; }
}

/** Spelling: choose an initial, then a character / word that starts with it. */
export class SpellScreen implements Screen {
  id = 'spell';
  private st: SpellState;
  private hist: SpellState[] = [];
  private sel!: Selector;
  constructor(private app: App) {
    this.st = { text: app.sentence, buf: '' };
    this.build();
  }
  private build() { this.sel = new Selector(spellRoot(this.app.speller!, this.st), settings.ways); }
  pendingLabel() { return this.st.buf ? ` ${this.app.speller!.pinyinOf(this.st.buf[0])}…` : ''; }
  dirs() { return ways(); }
  render() {
    renderRegions(regionsFromGroups(this.sel.groups(), this.dirs()), this.dirs());
    const py = this.st.buf ? this.app.speller!.pinyinOf(this.st.buf[0]) : '';
    setPrompt(this.st.buf
      ? `「${py}」开头的字或词，在哪一边？`
      : this.st.text ? '下一个字的声母（拼音第一个字母）在哪一边？说完了也在这里' : '第一个字的声母（拼音第一个字母）在哪一边？');
  }
  select(dir: Dir) {
    const leaf = this.sel.choose(this.dirs().indexOf(dir));
    if (!leaf) return;
    const next = applyLeaf(this.st, leaf);
    if (next === 'done') { this.app.push(new ConfirmScreen(this.app)); return; }
    this.hist.push(this.st);
    this.st = next;
    this.app.sentence = next.text;
    this.build();
    if (leaf.action === 'word') toast(`已加上：${(leaf.data as { text: string }).text} · 闭眼可撤回`);
  }
  back() {
    if (this.sel.canUndo()) return this.sel.undo();
    const prev = this.hist.pop();
    if (!prev) return false;
    this.st = prev;
    this.app.sentence = prev.text;
    this.build();
    return true;
  }
  spoken() { return spokenGroups(this.sel.groups(), this.dirs()); }
}

/** The only confirmation in the app: before a spelled sentence is read out. */
export class ConfirmScreen implements Screen {
  id = 'confirm';
  constructor(private app: App) {}
  dirs(): Dir[] { return ['L', 'R']; }
  render() {
    renderRegions({
      L: { big: { icon: '🔊', label: '说出来', sub: this.app.sentence } },
      R: { big: { icon: '✏️', label: '继续改' } },
    }, this.dirs());
    setPrompt('句子拼好了，要读出来吗？');
  }
  select(dir: Dir) {
    if (dir === 'L') {
      const text = this.app.sentence;
      this.app.sentence = '';
      void this.app.speak(text);
      this.app.home();
    } else this.app.pop();
  }
  back() { return false; }
  spoken() { return '左边：说出来。右边：继续改'; }
}

/** Yes / no answers to a caregiver's spoken question. */
export class YesNoScreen implements Screen {
  id = 'yesno';
  constructor(private app: App) {}
  dirs(): Dir[] { return settings.ways === 3 ? ['L', 'R', 'U'] : ['L', 'R']; }
  enter() { $('askBtn').textContent = '结束提问'; }
  exit() { $('askBtn').textContent = '问一个问题'; }
  render() {
    renderRegions({
      L: { big: { icon: '✅', label: '是' } },
      R: { big: { icon: '❌', label: '不是' } },
      U: { big: { icon: '🤷', label: '不知道' } },
    }, this.dirs());
    setPrompt('请照护者提问，病人看左边回答"是"，看右边回答"不是"');
  }
  select(dir: Dir) {
    const word = dir === 'L' ? '是' : dir === 'R' ? '不是' : '不知道';
    toast(word, 1500);
    void this.app.speak(word);
  }
  back() { return false; }
  spoken() { return ''; }
}

/** Pause: only a long look to the left wakes it up. Calling for help still works. */
export class RestScreen implements Screen {
  id = 'rest';
  constructor(private app: App) {}
  dirs(): Dir[] { return ['L']; }
  enter() {
    document.body.classList.add('resting');
    if (this.app.gaze) this.app.gaze.holdOverride = { dir: 'L', ms: 3000 };
  }
  exit() {
    document.body.classList.remove('resting');
    if (this.app.gaze) this.app.gaze.holdOverride = null;
  }
  render() {
    renderRegions({ L: { big: { icon: '🌙', label: '休息中', sub: '看左边 3 秒继续' } } }, this.dirs());
    setPrompt('休息中');
  }
  select() { this.app.home(); earcon('unlock'); }
  back() { return true; }
  spoken() { return ''; }
}
