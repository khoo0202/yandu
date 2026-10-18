import './styles.css';
import { App } from './app.ts';
import { GazeEngine } from './gaze/engine.ts';
import { Classifier } from './gaze/classifier.ts';
import { openSettings } from './screens/settings.ts';
import { runSetup } from './screens/setup.ts';
import { runTutorial } from './screens/tutorial.ts';
import { YesNoScreen } from './app.ts';
import { profile, settings } from './store.ts';
import { unlockAudio, setRate, say } from './speech.ts';
import { setProgress, setBackMeter, setFaceState, setNoFace, toast } from './ui/view.ts';
import { log } from './metrics.ts';
import type { Dir } from './engine/tree.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = new App();
setRate(settings.rate);
// handle for debugging from the browser console (chrome://inspect)
(window as unknown as { yandu: App }).yandu = app;
(window as unknown as { yanduDebug: unknown }).yanduDebug = { GazeEngine, Classifier };

// ---------- inputs that work without a camera ----------
document.querySelectorAll<HTMLElement>('.region').forEach(el => {
  el.addEventListener('click', () => app.onSelect(el.dataset.dir as Dir));
});
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const k = e.key;
  if (k === 'ArrowLeft') app.onSelect('L');
  else if (k === 'ArrowRight') app.onSelect('R');
  else if (k === 'ArrowUp') app.onSelect('U');
  else if (k === 'Backspace' || k === 'b') app.onBack();
  else if (k === 'c') app.onCall();
  else if (k === 'Escape') app.endCall();
  else return;
  e.preventDefault();
});
$('callOverlay').addEventListener('click', () => app.endCall());
$('backBtn').addEventListener('click', () => app.onBack());
$('askBtn').addEventListener('click', () => {
  if (app.top() instanceof YesNoScreen) app.pop();
  else app.push(new YesNoScreen(app));
});
$('gearBtn').addEventListener('click', () => openSettings(app));

// ---------- keep the screen on ----------
let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake() {
  try { wakeLock = await (navigator as unknown as { wakeLock: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen'); } catch { /* not supported */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) void keepAwake(); });
void wakeLock;

// ---------- start ----------
function startCard() {
  const first = !profile.setupDone;
  $('start').innerHTML = `<div class="card">
    <h1 class="brand">眼读</h1>
    <p>让说不了话、动不了手的人，用眼睛看左看右来说话。</p>
    ${first
      ? `<p>第一次使用：请照护者跟着提示做，大约 3 分钟。需要允许使用摄像头。</p>
         <button class="btn" id="goSetup" type="button">开始设置</button>`
      : `<button class="btn" id="goEyes" type="button">开始</button>
         <button class="btn sec" id="goCalib" type="button">开始并重新校准眼睛</button>`}
    <button class="btn sec" id="goTouch" type="button">先不用摄像头，用手点两边试试</button>
    <p id="startErr" class="note warn" hidden></p>
    <p class="note">手机竖放在病人脸的正前方，距离 30–50 厘米。电脑上可以用方向键 ← → ↑ 代替看，Backspace 代替闭眼。</p>
  </div>`;
  $('goTouch').onclick = () => {
    unlockAudio();
    $('start').hidden = true;
    document.body.classList.add('touch-only');
    setFaceState('手点模式', false);
    log('start', { detail: 'touch' });
    if (!profile.tutorialDone) runTutorial(app, () => app.home()); else app.home();
  };
  const eyes = async (mode: 'setup' | 'resume' | 'calib') => {
    unlockAudio();
    void keepAwake();
    const err = $('startErr');
    err.hidden = true;
    const btns = $('start').querySelectorAll<HTMLButtonElement>('button');
    btns.forEach(b => (b.disabled = true));
    const status = (t: string) => { err.hidden = false; err.classList.remove('warn'); err.textContent = t; };
    try {
      if (!window.isSecureContext) throw new Error('insecure');
      status('正在打开摄像头…');
      const g = app.gaze ?? new GazeEngine($<HTMLVideoElement>('cam'), {
        progress: (d, p) => setProgress(d, p),
        select: d => app.onSelect(d),
        lookedAway: () => app.undoLookAway(),
        backProgress: p => setBackMeter(p),
        back: () => app.onBack(),
        call: () => app.onCall(),
        face: present => { setNoFace(!present); setFaceState(present ? '识别正常' : '看不到脸', !present); },
        quality: msg => { if (msg) setFaceState(msg, true); else if (app.gaze?.last) setFaceState('识别正常', false); },
      });
      app.gaze = g;
      await g.startCamera();
      status('正在加载眼睛识别（第一次约 10–20 秒）…');
      await g.loadModel();
      g.start();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      err.hidden = false;
      err.classList.add('warn');
      err.textContent = m === 'insecure'
        ? '这个网址不能使用摄像头：要用 https 开头的网址打开（见说明）。'
        : /Permission|NotAllowed/i.test(m)
          ? '摄像头被拒绝了。请点地址栏左边的图标，把"摄像头"改成允许，再试一次。'
          : /model|fetch|wasm|Failed/i.test(m)
            ? '眼睛识别模块下载失败，请确认手机已联网后再试。'
            : `摄像头打不开：${m}`;
      btns.forEach(b => (b.disabled = false));
      log('start-error', { detail: m });
      return;
    }
    $('start').hidden = true;
    log('start', { detail: mode });
    if (mode === 'setup' || !app.gaze.clf) {
      await runSetup(app, mode !== 'setup' && profile.setupDone);
      if (!profile.tutorialDone) { runTutorial(app, () => app.home()); return; }
    } else if (mode === 'calib') {
      await runSetup(app, true);
    }
    app.home();
    void say('可以开始了');
  };
  document.getElementById('goSetup')?.addEventListener('click', () => void eyes('setup'));
  document.getElementById('goEyes')?.addEventListener('click', () => void eyes('resume'));
  document.getElementById('goCalib')?.addEventListener('click', () => void eyes('calib'));
}

async function boot() {
  await app.loadLexicon();
  startCard();
  app.home();
  // offline support once the app has been opened over https
  if ('serviceWorker' in navigator && window.isSecureContext && !location.hostname.match(/^(localhost|127\.)/)) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* optional */ });
  }
  if (!app.speller) toast('拼字词库没加载成功，拼字暂时不能用', 4000);
}
void boot();
