// Caregiver settings, operated by touch. Opening it pauses eye input.

import type { App } from '../app.ts';
import { settings, profile, saveSettings, saveProfile, DEFAULT_SETTINGS } from '../store.ts';
import { setRate, say } from '../speech.ts';
import { downloadCsv, summary } from '../metrics.ts';
import { runSetup } from './setup.ts';
import { runTutorial } from './tutorial.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function openSettings(app: App) {
  app.modal = true;
  if (app.gaze) app.gaze.paused = true;
  const m = $('modal');
  m.hidden = false;
  const s = summary();
  m.innerHTML = `<div class="card">
    <h1>设置</h1>
    <p class="note">今天：选择 ${s.selects} 次，撤回 ${s.undos} 次，说出 ${s.spoken.length} 句。${s.spoken.length ? `最近：${esc(s.spoken.slice(-3).join(' / '))}` : ''}</p>

    <h2>选择方式</h2>
    <label class="row" for="sStyle">怎么用眼睛选
      <select id="sStyle"><option value="outside">往手机外面看（推荐：找字时随便看，不会误选）</option><option value="onscreen">看屏幕左右两边（旧方式）</option></select>
      <span>改了以后会马上重新校准</span></label>
    <label class="row" for="sWays">方向数
      <select id="sWays"><option value="2">二向：左、右</option><option value="3">三向：左、右、上（更快，要能稳定往上看）</option></select></label>
    <label class="row" for="sTrig">触发方式
      <select id="sTrig"><option value="flick">往外看一下再看回来（最快，用于"往手机外面看"）</option><option value="dwell">看住一会儿（稳）</option><option value="glance">看一眼就算（快，容易误选）</option></select></label>
    <label class="row" for="sFlick">往外看多久就选中（"往外看一下"方式）：<b id="vFlick"></b><span>常常误选就调长；觉得慢就调短</span>
      <input type="range" id="sFlick" min="100" max="600" step="50"></label>
    <label class="row" for="sDwell">看住多久算选择（"看住一会儿"方式）：<b id="vDwell"></b>
      <input type="range" id="sDwell" min="300" max="2500" step="100"></label>
    <label class="row" for="sConf">要看得多准：<b id="vConf"></b><span>经常误选就调高；看了没反应就调低</span>
      <input type="range" id="sConf" min="50" max="95" step="5"></label>
    <label class="row" for="sBack">闭眼多久算退回：<b id="vBack"></b>
      <input type="range" id="sBack" min="1000" max="4000" step="250"></label>
    <label class="row" for="sCall">叫人手势
      <select id="sCall"><option value="triple">快速眨眼 3 下</option><option value="up">往上看 2 秒（只在二向时）</option><option value="off">关闭</option></select></label>

    <h2>提示和朗读</h2>
    <label class="check" for="sRead"><input type="checkbox" id="sRead">每一步读出两边的内容（视力不好时打开）</label>
    <label class="check" for="sSlow"><input type="checkbox" id="sSlow">连续撤回时自动调慢</label>
    <label class="row" for="sPrev">常用需求选中后，等多久再读出：<b id="vPrev"></b>
      <input type="range" id="sPrev" min="0" max="3000" step="250"></label>
    <label class="row" for="sRate">朗读语速：<b id="vRate"></b>
      <input type="range" id="sRate" min="0.6" max="1.4" step="0.1"></label>

    <h2>病人资料</h2>
    <label class="check" for="sPinyin"><input type="checkbox" id="sPinyin">认得拼音的第一个字母（显示拼字）</label>
    <label class="row" for="sFamily">常叫的家人（逗号隔开）<input type="text" id="sFamily"></label>

    <div class="btns">
      <button class="btn" id="bClose" type="button">返回</button>
      <button class="btn sec" id="bCalib" type="button">重新校准眼睛</button>
      <button class="btn sec" id="bSetup" type="button">重新做设置向导</button>
      <button class="btn sec" id="bTut" type="button">重新做教学</button>
      <button class="btn sec" id="bCsv" type="button">导出使用记录（CSV）</button>
      <button class="btn sec" id="bReset" type="button">恢复默认设置</button>
    </div>
  </div>`;

  const sync = () => {
    $<HTMLSelectElement>('sStyle').value = settings.selectStyle;
    $<HTMLSelectElement>('sWays').value = String(settings.ways);
    $<HTMLSelectElement>('sTrig').value = settings.trigger;
    $<HTMLInputElement>('sFlick').value = String(settings.flickMs);
    $('vFlick').textContent = `${(settings.flickMs / 1000).toFixed(2).replace(/0$/, '')} 秒`;
    $<HTMLInputElement>('sDwell').value = String(settings.trigger === 'glance' ? settings.glanceMs : settings.dwellMs);
    $('vDwell').textContent = `${((settings.trigger === 'glance' ? settings.glanceMs : settings.dwellMs) / 1000).toFixed(1)} 秒`;
    $<HTMLInputElement>('sConf').value = String(Math.round(settings.confidence * 100));
    $('vConf').textContent = `${Math.round(settings.confidence * 100)}%`;
    $<HTMLInputElement>('sBack').value = String(settings.backMs);
    $('vBack').textContent = `${(settings.backMs / 1000).toFixed(2).replace(/0$/, '')} 秒`;
    $<HTMLSelectElement>('sCall').value = settings.callGesture;
    $<HTMLInputElement>('sRead').checked = settings.readOptions;
    $<HTMLInputElement>('sSlow').checked = settings.autoSlow;
    $<HTMLInputElement>('sPrev').value = String(settings.speakPreviewMs);
    $('vPrev').textContent = `${(settings.speakPreviewMs / 1000).toFixed(2).replace(/0$/, '')} 秒`;
    $<HTMLInputElement>('sRate').value = String(settings.rate);
    $('vRate').textContent = settings.rate.toFixed(1);
    $<HTMLInputElement>('sPinyin').checked = profile.pinyin;
    $<HTMLInputElement>('sFamily').value = profile.family.join('，');
  };
  sync();

  const on = (id: string, ev: string, fn: (el: HTMLInputElement) => void) =>
    $<HTMLInputElement>(id).addEventListener(ev, e => { fn(e.target as HTMLInputElement); saveSettings(); saveProfile(); sync(); });
  on('sWays', 'change', el => { settings.ways = Number(el.value) === 3 ? 3 : 2; });
  $<HTMLSelectElement>('sStyle').addEventListener('change', async e => {
    settings.selectStyle = (e.target as HTMLSelectElement).value === 'onscreen' ? 'onscreen' : 'outside';
    saveSettings();
    if (!app.gaze) { sync(); return; }
    app.gaze.clf = null; // the old calibration was made for the other style
    m.innerHTML = '';
    await runSetup(app, true);
    close(); app.home();
  });
  on('sTrig', 'change', el => { settings.trigger = el.value === 'glance' ? 'glance' : el.value === 'flick' ? 'flick' : 'dwell'; });
  on('sFlick', 'input', el => { settings.flickMs = Number(el.value); });
  on('sDwell', 'input', el => { if (settings.trigger === 'glance') settings.glanceMs = Number(el.value); else settings.dwellMs = Number(el.value); });
  on('sConf', 'input', el => { settings.confidence = Number(el.value) / 100; });
  on('sBack', 'input', el => { settings.backMs = Number(el.value); });
  on('sCall', 'change', el => { settings.callGesture = el.value as typeof settings.callGesture; });
  on('sRead', 'change', el => { settings.readOptions = el.checked; });
  on('sSlow', 'change', el => { settings.autoSlow = el.checked; });
  on('sPrev', 'input', el => { settings.speakPreviewMs = Number(el.value); });
  on('sRate', 'change', el => { settings.rate = Number(el.value); setRate(settings.rate); void say('这是现在的语速'); });
  on('sPinyin', 'change', el => { profile.pinyin = el.checked; });
  on('sFamily', 'change', el => { profile.family = el.value.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 5); });

  const close = () => {
    m.hidden = true;
    m.innerHTML = '';
    app.modal = false;
    if (app.gaze) { app.gaze.paused = false; app.gaze.cooldown(800); }
  };
  $('bClose').onclick = () => { close(); app.home(); };
  $('bCalib').onclick = async () => {
    if (!app.gaze) { alertCard('手点模式没有打开摄像头。请回到开始页，选"开始"。'); return; }
    m.innerHTML = '';
    await runSetup(app, true);
    close(); app.home();
  };
  $('bSetup').onclick = async () => {
    if (!app.gaze) { alertCard('手点模式没有打开摄像头。请回到开始页，选"开始"。'); return; }
    m.innerHTML = '';
    await runSetup(app, false);
    close();
    runTutorial(app, () => app.home());
  };
  $('bTut').onclick = () => { close(); runTutorial(app, () => app.home()); };
  $('bCsv').onclick = () => downloadCsv();
  $('bReset').onclick = () => { Object.assign(settings, DEFAULT_SETTINGS); saveSettings(); sync(); };

  function alertCard(msg: string) {
    const n = document.createElement('p');
    n.className = 'note warn';
    n.textContent = msg;
    m.querySelector('.btns')?.prepend(n);
  }
}
