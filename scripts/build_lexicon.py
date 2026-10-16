"""Build public/data/lexicon.json for the spelling mode.

Usage:
    pip install pypinyin
    python3 scripts/build_lexicon.py path/to/zh_cn_50k.txt public/data/lexicon.json

zh_cn_50k.txt is the OpenSubtitles 2018 word-frequency list from
https://github.com/hermitdave/FrequencyWords (content/2018/zh_cn), licensed
CC BY-SA 4.0. Subtitles are spoken language, so the ranking fits bedside talk far
better than a news corpus. The bedside sentences in src/data/*.ts are mixed in so
care words (痰, 尿, 疼 ...) are always available and their word order is learned.

Output fields
    init   the 24 initials in display order, "code:pinyin:example:share per mille"
    chars  for each initial code, the everyday characters with that initial, most frequent first
    more   for each initial code, the rest of the 3755 standard characters (shown under 更多字)
    words  candidate words (2-4 characters), most frequent first, comma separated
    keys   initial-code string for each word in `words` (same order)
    bi     "A + likely next characters", space separated (inside words and in bedside sentences)
    wbi    "word|next1,next2,..." likely next words, learned from the bedside sentences
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from pypinyin import Style, pinyin

FREQ_PATH, OUT_PATH = sys.argv[1], sys.argv[2]
CORE_SIZE = 1200      # everyday characters taken from the spoken ranking
MAX_WORDS = 30000
BI_TOP = 24
PHRASE_WEIGHT = 60000  # weight of one bedside sentence pair, about a common word's count

INITIALS = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h',
            'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w', '']
CODE = {i: i for i in INITIALS}
CODE.update({'zh': 'Z', 'ch': 'C', 'sh': 'S', '': '_'})

# GB2312 level-1: the 3755 standard common simplified characters
level1 = []
for hi in range(0xB0, 0xD8):
    for lo in range(0xA1, 0xFF):
        if hi == 0xD7 and lo > 0xF9:
            break
        level1.append(bytes([hi, lo]).decode('gb2312'))
L1 = set(level1)

# spoken word frequencies
freq = {}
with open(FREQ_PATH, encoding='utf-8') as f:
    for line in f:
        parts = line.rstrip('\n').rsplit(' ', 1)
        if len(parts) == 2 and all(c in L1 for c in parts[0]):
            freq[parts[0]] = freq.get(parts[0], 0) + int(parts[1])

# bedside sentences and board text from the app's own data files
src = Path(__file__).resolve().parent.parent / 'src' / 'data'
phrases = []
for p in src.glob('*.ts'):
    for s in re.findall(r"'([^'\n]+)'", p.read_text(encoding='utf-8')):
        t = re.sub(r'[^一-鿿]', '', s)
        if len(t) >= 1 and all(c in L1 for c in t):
            phrases.append(t)
bedside_chars = {c for t in phrases for c in t}

char_freq = defaultdict(float)
for w, n in freq.items():
    for c in w:
        char_freq[c] += n
ranked = sorted(L1, key=lambda c: -char_freq.get(c, 0))
core = set(ranked[:CORE_SIZE]) | bedside_chars


def initial_code(x):
    return CODE.get(x, '_')


def char_initial(c):
    return initial_code(pinyin(c, style=Style.INITIALS, strict=False)[0][0])


by_init, more = defaultdict(list), defaultdict(list)
for c in ranked:  # already most frequent first
    (by_init if c in core else more)[char_initial(c)].append(c)

# words: spoken, 2-4 characters, everyday characters only
words, keys = [], []
for w, n in sorted(freq.items(), key=lambda t: -t[1]):
    if 2 <= len(w) <= 4 and all(c in core for c in w):
        words.append(w)
        keys.append(''.join(initial_code(x[0]) for x in pinyin(w, style=Style.INITIALS, strict=False)))
        if len(words) >= MAX_WORDS:
            break
vocab = set(words)

# next-character table: inside spoken words, plus every pair in the bedside sentences
nxt = defaultdict(lambda: defaultdict(float))
for w, n in freq.items():
    for a, b in zip(w, w[1:]):
        nxt[a][b] += n
for t in phrases:
    for a, b in zip(t, t[1:]):
        nxt[a][b] += PHRASE_WEIGHT
bi = []
for a in level1:
    if a in nxt:
        top = [c for c, v in sorted(nxt[a].items(), key=lambda t: -t[1])[:BI_TOP] if v >= 20]
        if top:
            bi.append(a + ''.join(top))


def segment(t):
    """Forward maximum matching with the spoken vocabulary."""
    out, i = [], 0
    while i < len(t):
        for L in (4, 3, 2, 1):
            piece = t[i:i + L]
            if L == 1 or piece in vocab:
                out.append(piece)
                i += L
                break
    return out


# next-word table from the bedside sentences
wn = defaultdict(lambda: defaultdict(int))
for t in phrases:
    seg = segment(t)
    for a, b in zip(seg, seg[1:]):
        wn[a][b] += 1
wbi = ['%s|%s' % (a, ','.join(b for b, _ in sorted(d.items(), key=lambda t: -t[1])[:12])) for a, d in wn.items()]

init_use = {CODE[i]: sum(char_freq.get(c, 0) for c in by_init[CODE[i]]) for i in INITIALS}
total_use = sum(init_use.values()) or 1
init = []
for i in INITIALS:
    code = CODE[i]
    example = by_init[code][0] if by_init[code] else ''
    init.append(f"{code}:{i or 'a o e'}:{example}:{round(1000 * init_use[code] / total_use)}")

data = {
    'init': init,
    'chars': {k: ''.join(v) for k, v in by_init.items()},
    'more': {k: ''.join(v) for k, v in more.items()},
    'words': ','.join(words),
    'keys': ','.join(keys),
    'bi': ' '.join(bi),
    'wbi': ' '.join(wbi),
}
with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
print(f'{len(core)} everyday chars, {sum(len(v) for v in more.values())} more, {len(words)} words, '
      f'{len(bi)} char rows, {len(wbi)} word rows, {len(phrases)} bedside sentences', file=sys.stderr)
