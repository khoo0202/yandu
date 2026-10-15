import type { Node } from '../engine/tree.ts';

// The needs board. Each category holds at most 8 items so a category is
// 3 binary steps deep. Leaves carry the sentence that is read aloud.
// Edit this file (or, later, the caregiver screen) to fit the patient.

const PAIN_PARTS: Node[] = [
  { id: 'pain-head', label: '头', say: '我头疼' },
  { id: 'pain-throat', label: '喉咙', say: '我喉咙疼' },
  { id: 'pain-chest', label: '胸口', say: '我胸口疼' },
  { id: 'pain-belly', label: '肚子', say: '我肚子疼' },
  { id: 'pain-back', label: '背', say: '我背疼' },
  { id: 'pain-waist', label: '腰', say: '我腰疼' },
  { id: 'pain-hand', label: '手', say: '我手疼' },
  { id: 'pain-leg', label: '腿和脚', say: '我腿疼' },
];

export function buildBoard(familyNames: string[]): Node[] {
  const family: Node[] = familyNames.length
    ? familyNames.slice(0, 5).map((n, i) => ({ id: `call-family-${i}`, label: n, icon: '👪', say: `请叫${n}来` }))
    : [{ id: 'call-family', label: '家人', icon: '👪', say: '请叫我的家人来' }];

  return [
    {
      id: 'cat-body', label: '身体不舒服', icon: '🤒', children: [
        { id: 'pain', label: '疼', icon: '😣', children: PAIN_PARTS },
        { id: 'itch', label: '痒', icon: '🐜', say: '我身上痒' },
        { id: 'numb', label: '麻', icon: '⚡', say: '我身上发麻' },
        { id: 'hot', label: '太热', icon: '🥵', say: '我觉得太热了' },
        { id: 'cold', label: '太冷', icon: '🥶', say: '我觉得太冷了' },
        { id: 'breath', label: '喘不过气', icon: '🫁', say: '我喘不过气' },
        { id: 'nausea', label: '想吐', icon: '🤢', say: '我想吐' },
        { id: 'dizzy', label: '头晕', icon: '😵', say: '我头晕' },
      ],
    },
    {
      id: 'cat-care', label: '护理', icon: '🛏️', children: [
        { id: 'suction', label: '吸痰', icon: '💨', say: '请帮我吸痰' },
        { id: 'turn', label: '翻身', icon: '🔄', say: '请帮我翻身' },
        { id: 'diaper', label: '换尿片', icon: '🧷', say: '请帮我换尿片' },
        { id: 'pee', label: '想小便', icon: '🚽', say: '我想小便' },
        { id: 'poo', label: '想大便', icon: '🚽', say: '我想大便' },
        { id: 'wipe', label: '擦身', icon: '🧽', say: '请帮我擦一擦身体' },
        { id: 'pillow', label: '调枕头', icon: '🛏️', say: '请帮我调一下枕头' },
        { id: 'bed', label: '床摇高或低', icon: '↕️', say: '请帮我调一下床的高低' },
      ],
    },
    {
      id: 'cat-want', label: '想要东西', icon: '🤲', children: [
        { id: 'water', label: '喝水', icon: '💧', say: '我口渴，想喝水' },
        { id: 'eat', label: '吃东西', icon: '🍚', say: '我饿了，想吃东西' },
        { id: 'light', label: '开灯或关灯', icon: '💡', say: '请帮我开灯或者关灯' },
        { id: 'fan', label: '风扇或空调', icon: '🌀', say: '请帮我调一下风扇或空调' },
        { id: 'tv', label: '看电视', icon: '📺', say: '我想看电视' },
        { id: 'phone', label: '手机', icon: '📱', say: '请把手机给我' },
        { id: 'glasses', label: '眼镜', icon: '👓', say: '请帮我戴眼镜' },
        { id: 'blanket', label: '盖或掀被子', icon: '🛌', say: '请帮我盖一下或者掀开被子' },
      ],
    },
    {
      id: 'cat-call', label: '叫人', icon: '📣', children: [
        ...family,
        { id: 'call-nurse', label: '护士', icon: '👩‍⚕️', say: '请叫护士来' },
        { id: 'call-doctor', label: '医生', icon: '🩺', say: '请叫医生来' },
        { id: 'stay', label: '陪我一下', icon: '🤝', say: '请陪我一下' },
      ],
    },
    {
      id: 'cat-feel', label: '心情和回答', icon: '💬', children: [
        { id: 'sleep', label: '累了想睡', icon: '😴', say: '我累了，想睡觉' },
        { id: 'ok', label: '我没事', icon: '🙂', say: '我没事' },
        { id: 'thanks', label: '谢谢', icon: '🙏', say: '谢谢你' },
        { id: 'scared', label: '我害怕', icon: '😨', say: '我害怕' },
        { id: 'love', label: '我爱你', icon: '❤️', say: '我爱你' },
        { id: 'dunno', label: '不知道', icon: '🤷', say: '我不知道' },
        { id: 'wait', label: '等一下', icon: '⏳', say: '请等一下' },
        { id: 'no', label: '不要', icon: '🚫', say: '我不要' },
      ],
    },
  ];
}

/** Every sentence on the board, used to seed spelling candidates. */
export function boardSentences(board: Node[]): string[] {
  const out: string[] = [];
  const walk = (ns: Node[]) => ns.forEach(n => { if (n.say) out.push(n.say); if (n.children) walk(n.children); });
  walk(board);
  return out;
}

/** Extra everyday phrases that are not on the board but are likely at the bedside. */
export const CARE_PHRASES: string[] = [
  '我想回家', '现在几点了', '今天谁来看我', '我想见孙子', '我想坐起来', '我想躺下', '帮我拿一下',
  '我想洗脸', '我想刷牙', '我想洗头', '我想剪指甲', '我想听音乐', '我想听新闻', '我想出去走走',
  '我想晒太阳', '把窗帘拉开', '把窗帘拉上', '声音小一点', '声音大一点', '电视关掉', '我吃饱了',
  '太烫了', '太咸了', '我不饿', '我不渴', '我想喝粥', '我想喝汤', '我想吃水果', '我想喝牛奶',
  '药吃了吗', '什么时候吃药', '医生什么时候来', '我好多了', '我不舒服', '我很难受', '我睡不着',
  '我做噩梦了', '我想哭', '我很想你', '你辛苦了', '对不起', '没关系', '不用了', '好的', '可以',
  '不可以', '快一点', '慢一点', '轻一点', '再来一次', '明天再说', '我想打电话', '给我看看照片',
  '我想看手机', '帮我充电', '我想吃药', '我要上厕所', '尿片湿了', '床单湿了', '我出汗了',
  '帮我挠痒', '帮我按摩', '我的脚冷', '我的手冷', '帮我穿袜子', '我想喝温水', '我要吸痰',
];
