// Caregiver setup wizard: place the phone, calibrate, test what the patient can do, basic info.

import type { App } from '../app.ts';
import type { Dir } from '../engine/tree.ts';
import { Classifier, type Cls } from '../gaze/classifier.ts';
import { settings, profile, saveSettings, saveProfile } from '../store.ts';
import { say, earcon, hasChineseVoice } from '../speech.ts';
import { log } from '../metrics.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function card(html: string) {
  const m = $('modal');
  m.hidden = false;
  m.innerHTML = `<div class="card">${html}</div>`;
  return m;
}
function closeModal() { const m = $('modal'); m.hidden = true; m.innerHTML = ''; }

function waitClick(...ids: string[]): Promise<string> {
  return new Promise(res => ids.forEach(id => { const b = document.getElementById(id); if (b) b.onclick = () => res(id); }));
}

// ---------- step 1: placement ----------
async function stepPlace(app: App) {
  card(`
    <p class="step">第 1 步 / 共 4 步</p>
    <h1>摆好手机</h1>
    <p>手机竖放在病人脸的正前方，距离 30–50 厘米，前置摄像头对着脸。脸部要亮，背后不要对着窗户。</p>
    <div class="preview"><canvas id="pv" width="320" height="240"></canvas></div>
    <p id="pvMsg" class="status">正在找脸…</p>
    <button class="btn" id="next1" type="button">位置好了，下一步</button>`);
  void say('第一步，摆好手机。手机放在病人脸的正前方，前置摄像头对着脸。');
  const cv = $<HTMLCanvasElement>('pv');
  const ctx = cv.getContext('2d')!;
  let run = true;
  const draw = () => {
    if (!run) return;
    requestAnimationFrame(draw);
    const g = app.gaze!;
    const v = g.video;
    if (v.readyState >= 2) {
      ctx.save(); ctx.scale(-1, 1); ctx.drawImage(v, -cv.width, 0, cv.width, cv.height); ctx.restore();
    }
    const f = g.last;
    const msg = $('pvMsg');
    if (!f) { msg.textContent = '看不到脸：请调整手机角度'; msg.className = 'status warn'; return; }
    const q = g.checkQuality(f);
    const ok = !q;
    ctx.strokeStyle = ok ? '#5bbf73' : '#e0a83a';
    ctx.lineWidth = 4;
    ctx.strokeRect(cv.width * (1 - f.box.x - f.box.w), cv.height * f.box.y, cv.width * f.box.w, cv.height * f.box.h);
    msg.textContent = q ?? '位置很好';
    msg.className = ok ? 'status ok' : 'status warn';
  };
  draw();
  await waitClick('next1');
  run = false;
}

// ---------- step 2: calibration ----------
interface CalPoint { cls: Cls; at: 'dot' | 'L' | 'R' | 'U'; x?: number; y?: number; say?: string; text: string; settle: number; ms: number }

/** "outside" mode: explain once, before the first calibration. */
async function outsideIntro() {
  card(`
    <p class="step">校准眼睛</p>
    <h1>怎么用眼睛选</h1>
    <p>找字的时候，眼睛可以在屏幕上随便看，不会选到。</p>
    <p>要选哪一边，就把眼睛<b>往那一边的手机外面看一下，再看回屏幕</b>，就选中了。</p>
    <p class="note">照护者可以把手放在手机左边和右边大约一个手掌远的地方，让病人看着手，更容易做到。</p>
    <button class="btn" id="calGo" type="button">开始校准</button>`);
  void say('找字的时候，眼睛可以在屏幕上随便看。要选哪一边，就往那一边的手机外面看一下，再看回屏幕。');
  await waitClick('calGo');
}

export async function calibrate(app: App, withUp: boolean): Promise<{ ok: boolean; upOk: boolean; msg?: string }> {
  const g = app.gaze!;
  const outside = settings.selectStyle === 'outside';
  if (outside) await outsideIntro();
  closeModal();
  const cal = $('calib');
  cal.hidden = false;
  const dot = $('cdot'), arrow = $('carrow'), text = $('ctext');
  const W = window.innerWidth, H = window.innerHeight;
  const midY = H * 0.55;
  const pts: CalPoint[] = outside
    ? [
      // reading: anywhere on the screen counts as "not choosing"
      { cls: 'C', at: 'dot', x: W * 0.25, y: H * 0.45, say: '先跟着圆点，看屏幕上的不同地方', text: '请看圆点', settle: 1600, ms: 900 },
      { cls: 'C', at: 'dot', x: W * 0.75, y: H * 0.45, text: '请看圆点', settle: 900, ms: 900 },
      { cls: 'C', at: 'dot', x: W * 0.5, y: H * 0.25, text: '请看圆点', settle: 900, ms: 900 },
      { cls: 'C', at: 'dot', x: W * 0.25, y: H * 0.75, text: '请看圆点', settle: 900, ms: 900 },
      { cls: 'C', at: 'dot', x: W * 0.75, y: H * 0.75, text: '请看圆点', settle: 900, ms: 900 },
      // choosing: past the phone's edge
      { cls: 'L', at: 'L', say: '现在眼睛往左边看，看到手机外面去', text: '眼睛往左边看，看到手机外面去', settle: 1800, ms: 1800 },
      { cls: 'C', at: 'dot', x: W * 0.5, y: midY, say: '看回屏幕中间', text: '看回屏幕中间', settle: 1100, ms: 900 },
      { cls: 'R', at: 'R', say: '现在眼睛往右边看，看到手机外面去', text: '眼睛往右边看，看到手机外面去', settle: 1800, ms: 1800 },
      ...(withUp ? [
        { cls: 'C', at: 'dot', x: W * 0.5, y: midY, say: '看回屏幕中间', text: '看回屏幕中间', settle: 1100, ms: 900 },
        { cls: 'U', at: 'U', say: '现在眼睛往上看，看到手机上面外面去', text: '眼睛往上看，看到手机上面外面去', settle: 1800, ms: 1800 },
      ] as CalPoint[] : []),
    ]
    : [
      { cls: 'C', at: 'dot', x: W / 2, y: midY, say: '请看中间的圆点', text: '请看中间的圆点', settle: 1400, ms: 1800 },
      { cls: 'L', at: 'dot', x: W * 0.25, y: midY, say: '请看左边的圆点', text: '请看左边的圆点', settle: 1400, ms: 1800 },
      { cls: 'C', at: 'dot', x: W / 2, y: midY, say: '请看回中间', text: '请看回中间', settle: 1400, ms: 1800 },
      { cls: 'R', at: 'dot', x: W * 0.75, y: midY, say: '请看右边的圆点', text: '请看右边的圆点', settle: 1400, ms: 1800 },
      ...(withUp ? [
        { cls: 'C', at: 'dot', x: W / 2, y: midY, say: '请看回中间', text: '请看回中间', settle: 1400, ms: 1800 },
        { cls: 'U', at: 'dot', x: W / 2, y: H * 0.2, say: '请往上看这个圆点', text: '请往上看这个圆点', settle: 1400, ms: 1800 },
      ] as CalPoint[] : []),
    ];
  const samples: Partial<Record<Cls, number[][]>> = {};
  void say('校准眼睛。头不要动，只动眼睛。');
  await sleep(2400);
  for (const p of pts) {
    dot.classList.remove('collect');
    if (p.at === 'dot') {
      arrow.hidden = true;
      dot.hidden = false;
      dot.style.left = `${p.x}px`; dot.style.top = `${p.y}px`;
    } else {
      dot.hidden = true;
      arrow.hidden = false;
      arrow.className = p.at.toLowerCase();
      arrow.textContent = p.at === 'L' ? '⟵' : p.at === 'R' ? '⟶' : '⟰';
    }
    text.textContent = p.text;
    if (p.say) void say(p.say);
    await sleep(p.settle);
    dot.classList.add('collect');
    const got = await g.collect(p.ms);
    (samples[p.cls] ??= []).push(...got);
    dot.classList.remove('collect');
    const okHere = got.length >= Math.min(8, p.ms / 120);
    text.textContent = okHere ? '✓' : '没看清，继续';
    earcon(okHere ? 'ok' : 'error');
    await sleep(250);
  }
  dot.hidden = false;
  arrow.hidden = true;
  cal.hidden = true;
  const enough = (c: Cls) => (samples[c]?.length ?? 0) >= 12;
  if (!enough('C') || !enough('L') || !enough('R')) {
    log('calib-fail', { detail: 'no face' });
    return { ok: false, upOk: false, msg: '没看清脸。请检查摆放和光线后再试。' };
  }
  const clf = Classifier.train(samples);
  const lr = clf.separation('L', 'R'), cl = Math.min(clf.separation('C', 'L'), clf.separation('C', 'R'));
  const up = withUp && enough('U') ? clf.separation('C', 'U') : 0;
  log('calib', { detail: `${settings.selectStyle} LR=${lr.toFixed(1)} CL=${cl.toFixed(1)} CU=${up.toFixed(1)}` });
  if (lr < 2.5 || cl < 1.5) {
    return {
      ok: false, upOk: false, msg: outside
        ? '"看屏幕"和"看手机外面"分不太开。请让病人眼睛往手机外面看得更远一些（可以看照护者的手），再试一次。'
        : '左右分不太开。请让病人眼睛往两边看得更多一些，或者把手机移近一点，再试一次。',
    };
  }
  g.setClassifier(clf);
  return { ok: true, upOk: up >= 2 };
}

// ---------- step 3: action test ----------
interface TestResult { lr: number; lrWrong: number; up: number; back: boolean; triple: boolean; times: number[] }

async function stepTest(app: App, upOk: boolean): Promise<TestResult> {
  const g = app.gaze!;
  const res: TestResult = { lr: 0, lrWrong: 0, up: 0, back: false, triple: false, times: [] };
  const seq: Dir[] = ['L', 'R', 'L', 'R', ...(upOk ? ['U', 'U'] as Dir[] : [])];
  const savedWays = settings.ways;
  settings.ways = upOk ? 3 : 2;
  g.dirs = upOk ? ['L', 'R', 'U'] : ['L', 'R'];
  const show = (title: string, big: string) => card(`
    <p class="step">第 3 步 / 共 4 步 · 动作测试</p>
    <h1>${title}</h1>
    <div class="testbig">${big}</div>
    <p class="status" id="tstat">等待病人做动作…</p>
    <button class="btn sec" id="skipT" type="button">跳过这一项</button>`);
  const waitFor = (kind: 'select' | 'back' | 'call', ms: number) => new Promise<{ kind: string; dir?: Dir; t: number } | null>(resolve => {
    const t0 = performance.now();
    let done = false;
    const fin = (v: { kind: string; dir?: Dir; t: number } | null) => { if (done) return; done = true; app.tap = null; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => fin(null), ms);
    app.tap = {
      select: d => { if (kind === 'select') fin({ kind, dir: d, t: performance.now() - t0 }); },
      back: () => { if (kind === 'back') fin({ kind, t: performance.now() - t0 }); },
      call: () => { if (kind === 'call') fin({ kind, t: performance.now() - t0 }); },
    };
    const sk = document.getElementById('skipT');
    if (sk) sk.onclick = () => fin(null);
  });
  const ARROW: Record<Dir, string> = { L: '⬅️', R: '➡️', U: '⬆️' };
  const NAME: Record<Dir, string> = settings.selectStyle === 'outside'
    ? (settings.trigger === 'flick'
      ? { L: '左边的手机外面，再看回来', R: '右边的手机外面，再看回来', U: '手机上面的外面，再看回来' }
      : { L: '左边的手机外面', R: '右边的手机外面', U: '手机上面的外面' })
    : { L: '左边', R: '右边', U: '上面' };
  void say('第三步，动作测试。请照着提示做。');
  await sleep(2200);
  for (const d of seq) {
    show(`请看${NAME[d]}`, ARROW[d]);
    void say(`请看${NAME[d]}`);
    g.cooldown(600);
    const r = await waitFor('select', 8000);
    if (r && r.dir === d) { res.times.push(r.t); if (d === 'U') res.up++; else res.lr++; earcon('ok'); }
    else if (r) { res.lrWrong++; earcon('error'); }
    await sleep(500);
    show(settings.selectStyle === 'outside' ? '请看回屏幕' : '请看回中间', '⏺');
    await sleep(1200);
  }
  show(`闭上眼睛 ${Math.round(settings.backMs / 1000)} 秒`, '😌');
  void say(`请闭上眼睛，数到${Math.round(settings.backMs / 1000)}再睁开`);
  res.back = !!(await waitFor('back', 9000));
  earcon(res.back ? 'ok' : 'error');
  await sleep(600);
  show('快速眨眼 3 下', '😉😉😉');
  void say('请快速眨眼三下');
  res.triple = !!(await waitFor('call', 8000));
  earcon(res.triple ? 'ok' : 'error');
  settings.ways = savedWays;
  log('action-test', { detail: JSON.stringify(res) });
  return res;
}

function recommend(r: TestResult, upOk: boolean) {
  const lrGood = r.lr >= 3;
  const upGood = upOk && r.up >= 2;
  settings.ways = lrGood && upGood ? 3 : 2;
  settings.callGesture = r.triple ? 'triple' : upGood && settings.ways === 2 ? 'up' : 'off';
  const median = r.times.length ? [...r.times].sort((a, b) => a - b)[Math.floor(r.times.length / 2)] : 0;
  settings.dwellMs = r.lrWrong > 0 ? 900 : 700;
  saveSettings();
  const lines = [
    `看左右：${r.lr}/4 次成功${r.lrWrong ? `，${r.lrWrong} 次选反` : ''}${median ? `，平均约 ${(median / 1000).toFixed(1)} 秒` : ''}`,
    upOk ? `看上面：${r.up}/2 次成功` : '看上面：校准时分不出来，不使用',
    `闭眼撤回：${r.back ? '可以' : '没有识别到'}`,
    `眨眼 3 下叫人：${r.triple ? '可以' : '没有识别到'}`,
  ];
  const summary = settings.ways === 3 ? '已设为三向选择（左、右、上），每一步更少。' : '已设为二向选择（左、右）。';
  const call = settings.callGesture === 'triple' ? '叫人：眨眼 3 下。' : settings.callGesture === 'up' ? '叫人：往上看 2 秒。' : '叫人手势无法使用，"叫人"仍可以在常用需求里选。';
  return { lines, summary: `${summary}${call}停留时间 ${(settings.dwellMs / 1000).toFixed(1)} 秒，以后可以在设置里改。`, lrGood };
}

// ---------- step 4: basic info ----------
async function stepInfo() {
  card(`
    <p class="step">第 4 步 / 共 4 步</p>
    <h1>基本信息</h1>
    <label class="check" for="fPinyin"><input type="checkbox" id="fPinyin" ${profile.pinyin ? 'checked' : ''}>病人认得拼音的第一个字母（b、p、m…）</label>
    <p class="note">不认得就关掉，拼字入口会隐藏，只用常用需求和"是/否"。</p>
    <label class="row" for="fFamily">常叫的家人，用逗号隔开（会加到"叫人"里）
      <input type="text" id="fFamily" placeholder="例如：阿明，妈妈" value="${esc(profile.family.join('，'))}"></label>
    <button class="btn sec" id="voiceTest" type="button">试读一句</button>
    <p class="note" id="voiceNote"></p>
    <button class="btn" id="done4" type="button">完成，开始教学</button>`);
  $('voiceTest').onclick = () => {
    void say('你好，我是眼读。');
    $('voiceNote').textContent = hasChineseVoice() ? '听到了吗？没声音请调大音量。' : '这台手机可能没有中文语音：请到 系统设置 → 文字转语音 里下载中文语音。';
  };
  await waitClick('done4');
  profile.pinyin = $<HTMLInputElement>('fPinyin').checked;
  profile.family = $<HTMLInputElement>('fFamily').value.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 5);
  saveProfile();
}

// ---------- wizard ----------
export async function runSetup(app: App, calibOnly = false) {
  app.modal = true;
  const g = app.gaze!;
  log('setup-start', { detail: calibOnly ? 'calib' : 'full' });
  if (!calibOnly) await stepPlace(app);
  for (;;) {
    const c = await calibrate(app, true);
    if (c.ok) {
      if (calibOnly) {
        // three directions only work when "up" can be told apart
        const fellBack = settings.ways === 3 && !c.upOk;
        if (fellBack) { settings.ways = 2; saveSettings(); }
        card(`<h1>校准完成</h1><p>${c.upOk ? '左、右、上都能分清，用三向选择。' : '左右能分清。'}</p>${fellBack ? '<p class="note warn">"往上看"分不太清，先用二向（左、右）。想再试三向：设置 → 重新校准眼睛，往上看时看得更高一些。</p>' : ''}<button class="btn" id="ok" type="button">好</button>`);
        await waitClick('ok');
        break;
      }
      app.modal = false; // let the gaze engine's events reach the test
      g.paused = false;
      const r = await stepTest(app, c.upOk);
      app.modal = true;
      const rec = recommend(r, c.upOk);
      card(`
        <p class="step">第 3 步 / 共 4 步 · 结果</p>
        <h1>${rec.lrGood ? '测试通过' : '看左右还不太稳'}</h1>
        <ul class="res">${rec.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
        <p>${esc(rec.summary)}</p>
        ${rec.lrGood ? '' : '<p class="note">可以再校准一次；或者先用，系统会自动调慢。</p>'}
        <button class="btn" id="go4" type="button">下一步</button>
        <button class="btn sec" id="again" type="button">重新校准再测</button>`);
      const b = await waitClick('go4', 'again');
      if (b === 'again') continue;
      break;
    }
    card(`<h1>校准没成功</h1><p>${esc(c.msg ?? '')}</p><button class="btn" id="retry" type="button">再试一次</button><button class="btn sec" id="later" type="button">先跳过</button>`);
    void say('校准没成功');
    if (await waitClick('retry', 'later') === 'later') break;
  }
  if (!calibOnly) {
    await stepInfo();
    profile.setupDone = true;
    saveProfile();
  }
  closeModal();
  app.modal = false;
  log('setup-done');
}
