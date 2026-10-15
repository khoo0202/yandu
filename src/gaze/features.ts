// Turn one MediaPipe face result into a small feature vector.
// Index meanings come from the MediaPipe face mesh (468/473 = iris centres).

export interface Pt { x: number; y: number }

export interface Frame {
  /** [irisX, blendX, yaw, irisY, blendY, pitch] */
  x: number[];
  /** 0 open .. 1 closed */
  blink: number;
  /** face bounding box in 0..1 image coordinates */
  box: { x: number; y: number; w: number; h: number };
  /** distance between outer eye corners, 0..1 of image width (how close the face is) */
  eyeDist: number;
}

export const FEATURE_NAMES = ['虹膜水平', '眼动水平', '转头', '虹膜垂直', '眼动垂直', '抬头'];

interface Category { categoryName: string; score: number }

export function extract(lm: Pt[] | undefined, cats: Category[] | undefined): Frame | null {
  if (!lm || lm.length < 474) return null;
  const ratio = (v: number, a: number, b: number) => (b - a) === 0 ? 0.5 : (v - a) / (b - a);
  // horizontal iris position inside each eye
  const h1 = ratio(lm[468].x, lm[33].x, lm[133].x);
  const h2 = ratio(lm[473].x, lm[362].x, lm[263].x);
  // vertical iris position between the lids
  const v1 = ratio(lm[468].y, lm[159].y, lm[145].y);
  const v2 = ratio(lm[473].y, lm[386].y, lm[374].y);
  const bs: Record<string, number> = {};
  for (const c of cats ?? []) bs[c.categoryName] = c.score;
  const g = (k: string) => bs[k] ?? 0;
  const bsH = g('eyeLookOutLeft') + g('eyeLookInRight') - g('eyeLookInLeft') - g('eyeLookOutRight');
  const bsV = g('eyeLookUpLeft') + g('eyeLookUpRight') - g('eyeLookDownLeft') - g('eyeLookDownRight');
  const yaw = ratio(lm[1].x, lm[234].x, lm[454].x);
  const eyeMidY = (lm[33].y + lm[263].y) / 2;
  const pitch = ratio(lm[1].y, eyeMidY, lm[152].y);
  const blink = (g('eyeBlinkLeft') + g('eyeBlinkRight')) / 2;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (let i = 0; i < 468; i += 4) {
    const p = lm[i];
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const eyeDist = Math.hypot(lm[33].x - lm[263].x, lm[33].y - lm[263].y);
  return {
    x: [(h1 + h2) / 2, bsH, yaw, (v1 + v2) / 2, bsV, pitch],
    blink,
    box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    eyeDist,
  };
}
