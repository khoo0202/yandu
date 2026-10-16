# 眼读 2.0

让说不了话、动不了手的人，用眼睛看左看右来说话。手机前置摄像头识别视线，每看一次排除一半选项。

- **常用需求板**：5 类 43 句床边常用的话，二向约 6–10 步，三向约 5–7 步。
- **是/否模式**：照护者提问，病人看左 = 是，看右 = 不是。
- **简拼拼字**：先选声母（b、p、m…，每个配例字），再选这个声母开头的字或词。
- **不会误选**：找字时眼睛可以在屏幕上随便看；要选哪一边，就往那一边的手机外面看（设置里可改回旧的"看屏幕两边"）。
- **随时可用**：闭眼 2 秒 = 退回一步；眨眼 3 下 = 叫人（响铃）。每用 20 分钟提醒休息眼睛。
- **上手引导**：照护者设置向导（摆放检查、校准、动作测试）+ 病人 4 节语音教学。

## 打开方式

部署后用手机 Chrome 打开 `https://<你的用户名>.github.io/yandu/`，允许摄像头。可以在 Chrome 菜单里选"添加到主屏幕"，之后像 app 一样全屏打开；第一次打开后离线也能用。

## 开发

```bash
npm install
npm run dev        # 本地开发，电脑浏览器打开；方向键 ← → ↑ 代替看，Backspace 代替闭眼，c = 叫人
npm run build      # 类型检查 + 打包到 dist/
npm run sim        # 模拟用户：统计各任务要看几次（npm run sim -- 3 为三向）
```

重新生成拼字词库：

```bash
pip install pypinyin
# 口语词频表：https://github.com/hermitdave/FrequencyWords 的 content/2018/zh_cn/zh_cn_50k.txt
python3 scripts/build_lexicon.py path/to/zh_cn_50k.txt public/data/lexicon.json
```

拼字会根据 `src/data/phrases.ts` 里的床边常用句猜下一个词和整句；把病人常说的话加进去，猜得会更准。

## 结构

| 目录 | 内容 |
| --- | --- |
| `src/engine/tree.ts` | 通用选择树：把选项分成 k 组、选一组、撤销 |
| `src/data/` | 需求板内容、首页结构、床边常用短句 |
| `src/lang/speller.ts` | 简拼：声母、候选字词、排序 |
| `src/gaze/` | 摄像头 → MediaPipe → 特征 → 分类器 → 事件 |
| `src/app.ts` | 画面栈和病人用的各个画面 |
| `src/screens/` | 设置向导、教学、照护者设置 |
| `sim/run.ts` | 模拟评测 |

使用记录只存在手机本地，可在设置里导出 CSV。不保存任何图像。

## 数据来源

- `public/data/lexicon.json` 的词频来自 [FrequencyWords](https://github.com/hermitdave/FrequencyWords)（OpenSubtitles 2018 中文字幕统计，CC BY-SA 4.0），按同一协议提供。
- 拼音由 [pypinyin](https://github.com/mozillazg/python-pinyin) 生成。

## 部署到 GitHub Pages

1. 仓库 Settings → Pages → Source 选 **GitHub Actions**。
2. 推送到 `main` 分支，Actions 会自动打包发布（约 1–2 分钟）。
