// Copy MediaPipe's wasm files into public/ so the app can run offline from its own site.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/@mediapipe/tasks-vision/wasm';
const dst = 'public/mediapipe/wasm';
if (!existsSync(src)) { console.error('run npm install first'); process.exit(1); }
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('copied MediaPipe wasm to', dst);
