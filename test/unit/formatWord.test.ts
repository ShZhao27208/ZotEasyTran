import test from "node:test";
import assert from "node:assert/strict";
import { formatWordEntry } from "../../src/modules/local/formatWord.ts";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    word: "model",
    wordLc: "model",
    phonetic: "/ˈmɑdəl/",
    phoneticSource: "cmu",
    translation: "",
    definition: "",
    pos: "n",
    collins: 4,
    oxford: 1,
    tag: "cet4 cet6",
    bnc: 551,
    frq: 504,
    exchange: "",
    isPhrase: false,
    senses: [],
    forms: [],
    examples: [],
    synsets: [],
    ...overrides,
  } as any;
}

test("formats a word with primary and extended senses", () => {
  const text = formatWordEntry(
    entry({
      senses: [
        { pos: "n", zh: "模型", domain: null, isCore: true, source: "ecdict" },
        { pos: "n", zh: "模范", domain: null, isCore: false, source: "ecdict" },
        {
          pos: "a",
          zh: "模范的",
          domain: null,
          isCore: false,
          source: "ecdict",
        },
        {
          pos: null,
          zh: "模型",
          domain: "计算机",
          isCore: false,
          source: "ecdict",
        },
      ],
      forms: ["models", "modelled"],
    }),
  );

  assert.match(text, /^model\s+\/ˈmɑdəl\//);
  assert.doesNotMatch(text, /COCA|BNC/);
  assert.match(text, /n\. 【本义】模型\s+【引申】模范/);
  assert.match(text, /a\. 【引申】模范的/);
  assert.match(text, /\[计算机\] 模型/);
  assert.match(text, /词形：models \/ modelled/);
});

test("formats a phrase without sense grouping", () => {
  const text = formatWordEntry(
    entry({
      word: "in terms of",
      isPhrase: true,
      phonetic: "",
      collins: 0,
      oxford: 0,
      bnc: 0,
      frq: 0,
      translation: "根据, 按照\\n[法] 以...措词",
      senses: [],
    }),
  );
  assert.match(text, /^in terms of/);
  assert.match(text, /根据, 按照\n\[法\] 以...措词/);
});

test("falls back to raw translation when no senses were parsed", () => {
  const text = formatWordEntry(
    entry({
      word: "oddword",
      phonetic: "",
      collins: 0,
      oxford: 0,
      bnc: 0,
      frq: 0,
      translation: "奇特的\\n罕见的",
      senses: [],
    }),
  );
  assert.match(text, /奇特的\n罕见的/);
});

test("marks a surface form resolved through the lemma table", () => {
  const text = formatWordEntry(
    entry({
      word: "study",
      matchedForm: "studies",
      senses: [
        { pos: "n", zh: "学习", domain: null, isCore: true, source: "ecdict" },
      ],
    }),
  );
  assert.match(text, /（由 studies 还原）/);
});

test("includes definition, examples, synonyms and exam tags", () => {
  const text = formatWordEntry(
    entry({
      definition: "a hypothetical description of a complex entity or process",
      tag: "cet4 ky",
      examples: [
        "a model of clarity",
        "the computer program was based on a model",
      ],
      synsets: [
        {
          id: "1-n",
          pos: "n",
          gloss: "a hypothetical description",
          lexname: "noun.cognition",
          rank: 1,
          zh: ["模型"],
          lemmas: ["example", "framework"],
        },
      ],
    }),
  );

  assert.match(text, /英文释义：a hypothetical description/);
  assert.match(text, /例句：a model of clarity/);
  assert.match(text, /近义词：example \/ framework/);
  assert.match(text, /标签：CET-4 · 考研/);
});
