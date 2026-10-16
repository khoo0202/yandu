// Voice-guided practice for the patient: 4 short lessons, each under 30 s.

import { App, ChoiceScreen, PreviewScreen, type Screen } from '../app.ts';
import type { Dir } from '../engine/tree.ts';
import { buildHome } from '../data/home.ts';
import { profile, saveProfile, settings } from '../store.ts';
import { say, earcon } from '../speech.ts';
import { renderRegions, setPrompt, toast } from '../ui/view.ts';
import { log } from '../metrics.ts';

const SIDE: Record<Dir, string> = { L: '左边', R: '右边', U: '上面' };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Lesson 1: look at the fruit on the named side. */
class LookLesson implements Screen {
  id = 'tut-look';
  private i = 0;
  private seq: Dir[];
  constructor(private app: App, private next: () => void) {
    this.seq = settings.ways === 3 ? ['L', 'R', 'U', 'L', 'R'] : ['L', 'R', 'L', 'R'];
  }
  dirs(): Dir[] { return settings.ways === 3 ? ['L', 'R', 'U'] : ['L', 'R']; }
  private target() { return this.seq[this.i]; }
  private instruction() {
    const t = this.target();
    const fruit = t === 'L' ? '苹果' : t === 'R' ? '香蕉' : '葡萄';
    return settings.selectStyle === 'outside' ? `选${SIDE[t]}的${fruit}：眼睛往${SIDE[t]}看到手机外面` : `请看${SIDE[t]}的${fruit}`;
  }
  enter() {
    void say(settings.selectStyle === 'outside'
      ? `第一课：用眼睛选。屏幕上的东西可以随便看，不会选到。要选哪一边，就往那一边的手机外面看，停一下。${this.instruction()}。`
      : `第一课：用眼睛选。${this.instruction()}，看住不动，等它填满。`);
  }
  render() {
    if (this.i >= this.seq.length) return;
    const t = this.target();
    renderRegions({
      L: { big: { icon: '🍎', label: '苹果' }, glow: t === 'L', dim: t !== 'L' },
      R: { big: { icon: '🍌', label: '香蕉' }, glow: t === 'R', dim: t !== 'R' },
      U: { big: { icon: '🍇', label: '葡萄' }, glow: t === 'U', dim: t !== 'U' },
    }, this.dirs());
    setPrompt(`第一课 · ${this.instruction()}（${this.i + 1}/${this.seq.length}）`);
  }
  select(dir: Dir) {
    if (this.i >= this.seq.length) return;
    if (dir !== this.target()) { earcon('error'); void say(`再看一次${SIDE[this.target()]}`); return; }
    earcon('ok');
    this.i++;
    if (this.i >= this.seq.length) { void say('很好！'); setTimeout(this.next, 900); return; }
    void say(`很好。${this.instruction()}`);
  }
  back() { return true; }
}

/** Lesson 2: answer obvious questions with yes / no. */
class QuizLesson implements Screen {
  id = 'tut-quiz';
  private i = 0;
  private qs: [string, Dir][] = [['一加一等于二，对吗？', 'L'], ['猫会飞，对吗？', 'R'], ['你现在是用眼睛在选，对吗？', 'L']];
  constructor(private app: App, private next: () => void) {}
  dirs(): Dir[] { return ['L', 'R']; }
  enter() { void say(`第二课：回答问题。看左边是"是"，看右边是"不是"。${this.qs[0][0]}`); }
  render() {
    if (this.i >= this.qs.length) return;
    renderRegions({ L: { big: { icon: '✅', label: '是' } }, R: { big: { icon: '❌', label: '不是' } } }, this.dirs());
    setPrompt(`第二课 · ${this.qs[this.i][0]}`);
  }
  select(dir: Dir) {
    if (this.i >= this.qs.length) return;
    if (dir !== this.qs[this.i][1]) { earcon('error'); void say(`再想一想。${this.qs[this.i][0]}`); return; }
    earcon('ok');
    this.i++;
    if (this.i >= this.qs.length) { void say('答对了！'); setTimeout(this.next, 900); return; }
    void say(`答对了。${this.qs[this.i][0]}`);
  }
  back() { return true; }
}

/** Lesson 3: make a choice, then undo it by closing the eyes. */
class UndoLesson implements Screen {
  id = 'tut-undo';
  private phase: 'pick' | 'close' = 'pick';
  constructor(private app: App, private next: () => void) {}
  dirs(): Dir[] { return ['L', 'R']; }
  enter() { void say(settings.selectStyle === 'outside' ? '第三课：撤回。先选右边的星星：往右边的手机外面看。' : '第三课：撤回。先看右边的星星。'); }
  render() {
    if (this.phase === 'pick') {
      renderRegions({ L: { big: { icon: '🌙', label: '月亮' }, dim: true }, R: { big: { icon: '⭐', label: '星星' }, glow: true } }, this.dirs());
      setPrompt(settings.selectStyle === 'outside' ? '第三课 · 选右边的星星：往右边手机外面看' : '第三课 · 请看右边的星星');
    } else {
      renderRegions({ L: { big: { icon: '😌', label: '闭上眼睛', sub: `数到 ${Math.round(settings.backMs / 1000)}` }, glow: true }, R: { big: { icon: '⭐', label: '刚才选了星星' }, dim: true } }, this.dirs());
      setPrompt(`第三课 · 选错了也没关系：闭上眼睛 ${Math.round(settings.backMs / 1000)} 秒，就能撤回`);
    }
  }
  select(dir: Dir) {
    if (this.phase === 'pick') {
      if (dir !== 'R') { void say('请看右边的星星'); return; }
      this.phase = 'close';
      void say(`选好了。假设你选错了：闭上眼睛 ${Math.round(settings.backMs / 1000)} 秒，就能撤回。现在试试。`);
    }
  }
  back() {
    if (this.phase === 'close') { void say('很好，撤回了！'); setTimeout(this.next, 1200); }
    return true;
  }
}

/** Lesson 4: say "I want water" through the real home screen, with the right side lit up. */
function guidedLesson(app: App, finish: () => void): Screen {
  const nodes = buildHome({ sentence: '', lastSpoken: '', board: app.board, pinyin: false });
  const s = new ChoiceScreen('tut-guided', nodes, leaf => {
    if (leaf.say) app.push(new PreviewScreen(app, leaf.say, finish));
  }, {
    guide: 'water',
    onWrong: () => { earcon('error'); void say('不是这边。请选发亮的那一边'); },
  });
  const enter = () => void say('第四课：说一句话。我们一起说"我想喝水"。每一步都看发亮的那一边。');
  s.enter = enter;
  return s;
}

export function runTutorial(app: App, onDone: () => void) {
  log('tutorial-start');
  const skip = $('skipBtn');
  skip.hidden = false;
  const finish = () => {
    skip.hidden = true;
    profile.tutorialDone = true;
    saveProfile();
    log('tutorial-done');
    void say('教学完成！以后想说什么，常用的话在左边。');
    toast('教学完成', 2500);
    onDone();
  };
  skip.onclick = () => { log('tutorial-skip'); finish(); };
  const lessons: ((next: () => void) => Screen)[] = [
    next => new LookLesson(app, next),
    next => new QuizLesson(app, next),
    next => new UndoLesson(app, next),
    next => guidedLesson(app, next),
  ];
  let i = 0;
  const go = () => {
    if (i >= lessons.length) { finish(); return; }
    const make = lessons[i++];
    app.only(make(go));
  };
  go();
}
