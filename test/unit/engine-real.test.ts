import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  cleanSelectionText,
  translateText,
} from "../../src/modules/local/engine.ts";

const DB_PATH = "dist/dictionary.sqlite";
const hasDb = fs.existsSync(DB_PATH);
const db = hasDb ? new DatabaseSync(DB_PATH, { readOnly: true }) : null;

const qWord = db?.prepare(
  "SELECT word, pos, translation FROM words WHERE word_lc = ? ORDER BY collins DESC, frq LIMIT 1",
);
const qSenses = db?.prepare(
  "SELECT pos, zh, domain, is_core FROM senses WHERE word_lc = ? ORDER BY ord",
);
const qLemma = db?.prepare(
  "SELECT lemma FROM forms WHERE form_lc = ? ORDER BY CASE WHEN form = lemma THEN 1 ELSE 0 END LIMIT 1",
);

function makeLexicon() {
  return {
    async lookupWord(word: string) {
      let lc = word.toLowerCase();
      let row = qWord?.get(lc) as any;
      const lemma = qLemma?.get(lc) as any;
      if (lemma?.lemma && lemma.lemma !== lc) {
        const lemmaRow = qWord?.get(lemma.lemma) as any;
        if (lemmaRow) {
          lc = lemma.lemma;
          row = lemmaRow;
        }
      }
      if (!row) return null;
      return {
        word: row.word,
        pos: String(row.pos || "")
          .split(",")
          .filter(Boolean),
        senses: (qSenses?.all(lc) as any[]).map((s) => ({
          pos: s.pos,
          zh: s.zh,
          isCore: Number(s.is_core) === 1,
          domain: s.domain,
        })),
      };
    },
    async lookupMeta(words: string[]) {
      const map = new Map<string, { pos: string[] }>();
      for (const word of words) {
        const row = qWord?.get(word.toLowerCase()) as any;
        if (row) {
          map.set(word.toLowerCase(), {
            pos: String(row.pos || "")
              .split(",")
              .filter(Boolean),
          });
        }
      }
      return map;
    },
    async lookupLemma(words: string[]) {
      const map = new Map<string, string>();
      for (const word of words) {
        const row = qLemma?.get(word.toLowerCase()) as any;
        if (row?.lemma) map.set(word.toLowerCase(), row.lemma);
      }
      return map;
    },
    async lookupPhrases() {
      return new Map<string, string>();
    },
  };
}

test(
  "real dictionary: academic sentence samples",
  { skip: !hasDb },
  async () => {
    const lexicon = makeLexicon();
    const cases: Array<[string, string[]]> = [
      [
        "The results suggest that the proposed model significantly improves accuracy.",
        ["结果表明", "模型", "准确率"],
      ],
      [
        "We propose a novel framework that integrates A with B to address C.",
        ["框架", "整合"],
      ],
      [
        "Although the underlying mechanism remains unclear, these findings provide new insights into the role of X.",
        ["虽然", "机制", "见解"],
      ],
      [
        "Samples were collected from 120 participants between March and June 2024.",
        ["120", "2024年3月", "6月"],
      ],
      [
        "The expression of gene X was significantly upregulated compared with the control group.",
        ["对照组", "上调"],
      ],
      [
        "In this study, we develop a framework that integrates A with B.",
        ["在本研究中", "框架"],
      ],
      [
        "It is important to note that the method is effective.",
        ["需要指出的是", "有效"],
      ],
      ["There are several limitations in this study.", ["本研究", "局限"]],
      [
        "The performance of the proposed method was evaluated on a public dataset.",
        ["性能", "评估"],
      ],
      [
        "Compared with the baseline, our approach significantly reduces the error.",
        ["与基线相比", "降低"],
      ],
    ];

    for (const [english, expected] of cases) {
      const chinese = await translateText(english, lexicon as any);
      for (const fragment of expected) {
        assert.ok(
          chinese.includes(fragment),
          `expected "${fragment}" in: ${chinese}\nfrom: ${english}`,
        );
      }
    }
  },
);

test(
  "real dictionary: protected spans are restored verbatim",
  { skip: !hasDb },
  async () => {
    const lexicon = makeLexicon();
    const text =
      "The model achieved 95.2% accuracy on 30 samples, and p < 0.05 was considered significant [12].";
    const chinese = await translateText(text, lexicon as any);
    assert.ok(chinese.includes("95.2%"), chinese);
    assert.ok(chinese.includes("30"), chinese);
    assert.ok(chinese.includes("< 0.05"), chinese);
    assert.ok(chinese.includes("[12]"), chinese);
  },
);

test("garbled concat selection is cleaned", { skip: !hasDb }, async () => {
  const raw =
    "in mobility, wh As strain increased As strain increased energies ruptured As strain increased, the hydrogen bonds with higher binding energies ruptured, followed by the eventual breakage of the La3+–ligand bidentate coordination bonds";
  const cleaned = cleanSelectionText(raw);
  const lexicon = makeLexicon();
  const chinese = await translateText(raw, lexicon as any);
  assert.ok(!cleaned.startsWith("in mobility"));
  assert.ok(!/As strain increased As strain increased/i.test(cleaned));
  assert.ok(!/瓦特|瓦时/.test(chinese), chinese);
});

test("regression: domain terms and tagging", { skip: !hasDb }, async () => {
  const lexicon = makeLexicon();
  const cases: Array<[string, string[], string[]]> = [
    [
      "The current study investigates the potential application of this material.",
      ["本研究", "潜在应用"],
      ["电流", "势"],
    ],
    [
      "The computer vision model uses a transformer with attention mechanisms.",
      ["计算机视觉", "使用", "注意力机制"],
      [],
    ],
    [
      "The elastomer also exhibited fluorescent thermal stability up to 240 °C.",
      ["展现", "高达"],
      [],
    ],
    ["The material exhibited thermal stability.", ["展现"], ["展现的"]],
    ["The increased thermal stability is desirable.", ["热稳定性"], []],
    [
      "The PUU-1 exhibited unparalleled toughness and excellent tensile strength.",
      ["PUU-1", "无与伦比"],
      [],
    ],
    [
      "The La3+ coordination restricted intramolecular motion, thereby enhancing fluorescence through aggregation-induced emission.",
      ["聚集诱导发光"],
      ["[化学]"],
    ],
    [
      "The coating improved the blast-resistance capabilities of the composite.",
      ["抗爆性"],
      ["blast-resistance"],
    ],
    [
      "Hierarchical hydrogen bonds and synergistic dynamic bonds dissipate energy.",
      ["多级氢键", "协同动态键", "耗散"],
      [],
    ],
    [
      "Aggregation-induced emission enables optical anti-counterfeiting and information encryption.",
      ["聚集诱导发光", "光学防伪", "信息加密"],
      [],
    ],
    [
      "The elastomer exhibits record toughness and excellent recyclability.",
      ["弹性体", "创纪录", "韧性"],
      [],
    ],
    [
      "Ionic radii and coordination number affect the La3+ coordination.",
      ["离子半径", "配位数", "配位"],
      [],
    ],
    [
      "DSC and TGA were used to evaluate the thermal stability.",
      ["差示扫描量热法", "热重分析", "热稳定性"],
      [],
    ],
    [
      "The composite shows high tensile strength and fracture toughness.",
      ["复合材料", "拉伸强度"],
      [],
    ],
    ["Recyclability is important for sustainable materials.", ["可回收性"], []],
    [
      "Fracture toughness is important for structural materials.",
      ["断裂韧性"],
      [],
    ],
    ["Information encryption protects optical patterns.", ["信息加密"], []],
  ];
  for (const [english, expected, forbidden] of cases) {
    const chinese = await translateText(english, lexicon as any);
    for (const fragment of expected) {
      assert.ok(
        chinese.includes(fragment),
        `expected "${fragment}" in: ${chinese}\nfrom: ${english}`,
      );
    }
    for (const fragment of forbidden) {
      assert.ok(
        !chinese.includes(fragment),
        `unexpected "${fragment}" in: ${chinese}\nfrom: ${english}`,
      );
    }
  }
});
