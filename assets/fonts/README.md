# Fonts for Unicode text in signed PDFs

Used only when a name, title or other certificate value contains characters the built-in PDF font
(Helvetica, WinAnsi encoding) cannot encode. Latin-1 text keeps using Helvetica exactly as before.
At signing time, HarfBuzz (`harfbuzzjs`, MIT) subsets the font down to the characters actually
used (a few KB). pdf-lib then embeds that subset.

| File | Source | License |
|---|---|---|
| `NotoSans-Regular.ttf` | `google/fonts` `ofl/notosans/NotoSans[wdth,wght].ttf` (commit `8b0a1d0`, sha256 `bfb7bb69…`) | SIL Open Font License 1.1 (`OFL-NotoSans.txt`) |
| `NotoSansSC-Regular.ttf` | `google/fonts` `ofl/notosanssc/NotoSansSC[wght].ttf` (commit `a85815a`, sha256 `a3041811…`) | SIL Open Font License 1.1 (`OFL-NotoSansSC.txt`) |

**Processing** (fonttools 4.55.3; modified versions as the OFL permits; no Reserved Font Name is used):

```sh
fonttools varLib.instancer 'NotoSans[wdth,wght].ttf' wght=400 wdth=100 -o NotoSans-Regular.full.ttf
pyftsubset NotoSans-Regular.full.ttf --unicodes='*' --no-hinting --output-file=NotoSans-Regular.ttf

fonttools varLib.instancer 'NotoSansSC[wght].ttf' wght=400 -o NotoSansSC-Regular.full.ttf
pyftsubset NotoSansSC-Regular.full.ttf \
  --unicodes='U+0020-024F,U+02B0-036F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+3000-303F,U+3040-30FF,U+31F0-31FF,U+4E00-9FFF,U+F900-FAFF,U+FF00-FFEF' \
  --drop-tables+=VORG,vhea,vmtx --no-hinting --output-file=NotoSansSC-Regular.ttf
```

**Coverage:**
- Noto Sans: Latin including extended and Vietnamese, Greek, Cyrillic.
- Noto Sans SC: CJK Unified Ideographs (U+4E00–9FFF, which covers Simplified and most Traditional Chinese name characters), Japanese kana, and CJK punctuation and full-width forms.

Characters neither font covers still print as `?`, as before. That includes Hangul, Arabic, Hebrew, Indic scripts, emoji and CJK Extension A and above. The exact typed name is always stored server-side, on the signing request and in the `document_signed` event.
