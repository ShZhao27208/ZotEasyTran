# Local dictionary

ZotEasyTran does not ship the dictionary inside the `.xpi`. It is built once
from open data and copied to the Zotero data directory.

## Sources

| File | Download | License |
|---|---|---|
| `ecdict.csv` (~66 MB) | https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv | MIT |
| `lemma.en.txt` | https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt | MIT |
| `wordroot.txt` | https://raw.githubusercontent.com/skywind3000/ECDICT/master/wordroot.txt | MIT |
| `wordnet.zip` (WordNet 3.0) | https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/wordnet.zip | Princeton WordNet License |
| `omw-1.4.zip` (contains COW) | https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/omw-1.4.zip | COW License |
| `cmudict.dict` | https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict | BSD-2-Clause |

GitHub raw is sometimes slow from mainland China; a mirror such as
`https://gh-proxy.com/https://raw.githubusercontent.com/...` works.

Expected layout:

```
assets/
  ecdict.csv
  lemma.en.txt
  wordroot.txt
  cmudict.dict
  wordnet/            # extracted wordnet.zip
  omw-1.4/cow/wn-data-cmn.tab
```

## Build

```bash
npm run build:dict
# or
ZET_ASSETS=/path/to/assets ZET_DB=/path/to/dictionary.sqlite node scripts/build-dict.mjs
```

Measured on this machine:

- build time: ~7 s
- output: `dist/dictionary.sqlite` ~241 MB
- words: 770,611 (366,599 phrases)
- senses: 1,195,449
- forms: 90,198
- WordNet synsets: 117,659 (206,941 English lemmas, 79,809 Chinese lemmas)
- phonetic coverage: ECDICT 218,065 + CMU 83,506 (academic words: 99.6% union)

`scripts/check-dict.mjs` validates counts and sample entries.

## Schema

```sql
words(id, word, word_lc, phonetic, phonetic_source, translation, definition,
      pos, collins, oxford, tag, bnc, frq, exchange, is_phrase)

senses(word_lc, pos, ord, zh, domain, is_core, source)

forms(form_lc, form, lemma)              -- inflection -> lemma

synsets(id, pos, gloss, lexname)         -- WordNet 3.0
synset_words(synset, lang, lemma, rank)  -- lang: en | cmn

glossary(term_lc, term, translation, domain, case_sensitive)
meta(key, value)
```

Indexes: `words(word_lc)`, `senses(word_lc)`, `forms(form_lc)`,
`synset_words(synset, lang)`, `synset_words(lang, lemma)`.

## Sense model

- ECDICT `translation` is split by lines, part-of-speech markers (`n.`, `vt.`,
  `a.`, ...) and domain tags (`[计]`, `[医]`, ...).
- The first non-domain sense of the primary part of speech is marked
  `is_core = 1` and displayed as **本义**; remaining senses are **引申义**.
- Senses with a domain tag are grouped as **专业义** (e.g. `[计算机]`).
- `[网络]` entries are displayed last and never marked primary.
- WordNet/COW supply synset glosses and Chinese lemmas for future sense
  disambiguation; the v1 engine mainly uses ECDICT senses plus the curated
  academic termbase.

## Phonetics

1. Prefer CMUdict (ARPAbet → IPA, stress moved before the syllable onset).
2. Fall back to ECDICT phonetic (normalize `ә`→`ə`, `'`→`ˈ`, `,`→`ˌ`,
   `:`→`ː`).
3. If neither exists, the word has no phonetic; speech synthesis does not need
   it.

## Runtime

Default path: `<Zotero data dir>/zoteasytran/dictionary.sqlite`.
Override in `设置 → ZotEasyTran 本地翻译 → 词典文件`.

The plugin opens it through `Zotero.DBConnection(absolutePath)` (external
SQLite), validates the `meta` table, then serves queries. No network access is
performed by the local engine.

## Rebuilding after upgrading

`scripts/build-dict.mjs` writes `dist/dict-manifest.json` with source sizes,
sha256 checksums, counts and build time. Re-copy the new `dictionary.sqlite` to
the Zotero data directory (Zotero must be closed) or point the setting to it.
