"""Build public/data/lexicon.json for the spelling mode.

Usage:
    pip install pypinyin
    python3 scripts/build_lexicon.py path/to/jieba/dict.txt public/data/lexicon.json

The jieba word-frequency list (dict.txt, MIT licence) comes from the jieba
source package: `pip download jieba --no-deps --no-binary :all:` and unpack it.

Output fields
    init   the 24 initials in display order, each as "code:pinyin:example:share per mille"
    chars  for each initial code, the common characters with that initial, most frequent first
    words  candidate words, most frequent first, comma separated
    keys   initial-code string for each word in `words` (same order)
    bi     "A + likely next characters" entries, space separated
"""
import json
import sys
from collections import defaultdict

from pypinyin import Style, pinyin

DICT_PATH, OUT_PATH = sys.argv[1], sys.argv[2]
MAX_WORDS = 50000
BI_TOP = 24

# initials in the order shown on screen; zh/ch/sh get one-letter codes
INITIALS = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h',
            'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w', '']
CODE = {i: i for i in INITIALS}
CODE.update({'zh': 'Z', 'ch': 'C', 'sh': 'S', '': '_'})

# GB2312 level-1: the 3755 most common simplified characters
chars = []
for hi in range(0xB0, 0xD8):
    for lo in range(0xA1, 0xFF):
        if hi == 0xD7 and lo > 0xF9:
            break
        chars.append(bytes([hi, lo]).decode('gb2312'))
charset = set(chars)

entries = []
char_freq = defaultdict(int)
with open(DICT_PATH, encoding='utf-8') as f:
    for line in f:
        parts = line.split()
        if len(parts) < 2:
            continue
        w, n = parts[0], int(parts[1])
        for c in w:
            char_freq[c] += n
        if 1 <= len(w) <= 4 and all(c in charset for c in w):
            entries.append((n, w))


def initial_code(syllable_initial):
    return CODE.get(syllable_initial, '_')


# characters per initial (default reading), most frequent first
by_init = defaultdict(list)
for c in chars:
    ini = pinyin(c, style=Style.INITIALS, strict=False)[0][0]
    by_init[initial_code(ini)].append(c)
for k in by_init:
    by_init[k].sort(key=lambda c: -char_freq.get(c, 0))

# words: phrase-aware readings handle most polyphones (银行 -> y h)
entries.sort(key=lambda t: -t[0])
seen, words, keys = set(), [], []
for n, w in entries:
    if w in seen:
        continue
    seen.add(w)
    ini = pinyin(w, style=Style.INITIALS, strict=False)
    keys.append(''.join(initial_code(x[0]) for x in ini))
    words.append(w)
    if len(words) >= MAX_WORDS:
        break

# next-character predictions from every character pair inside words
nxt = defaultdict(lambda: defaultdict(int))
for n, w in entries:
    for a, b in zip(w, w[1:]):
        nxt[a][b] += n
bi = []
for a in chars:
    if a in nxt:
        top = [c for c, v in sorted(nxt[a].items(), key=lambda t: -t[1])[:BI_TOP] if v >= 20]
        if top:
            bi.append(a + ''.join(top))

# how often each initial starts a character in running text (for a fixed, frequency-shaped tree)
init_use = {CODE[i]: sum(char_freq.get(c, 0) for c in by_init[CODE[i]]) for i in INITIALS}
total_use = sum(init_use.values()) or 1

init = []
for i in INITIALS:
    code = CODE[i]
    example = by_init[code][0] if by_init[code] else ''
    share = round(1000 * init_use[code] / total_use)
    init.append(f"{code}:{i or 'a o e'}:{example}:{share}")

data = {
    'init': init,
    'chars': {k: ''.join(v) for k, v in by_init.items()},
    'words': ','.join(words),
    'keys': ','.join(keys),
    'bi': ' '.join(bi),
}
with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
print(f'{len(words)} words, {sum(len(v) for v in by_init.values())} chars, {len(bi)} bigram rows', file=sys.stderr)
