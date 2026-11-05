import test from "node:test";
import { translateText } from "../../src/modules/local/engine.ts";

const M: Record<string, { pos: string; zh: string }> = {
  result: { pos: "n", zh: "结果" },
  results: { pos: "n", zh: "结果" },
  suggest: { pos: "v", zh: "表明" },
  suggests: { pos: "v", zh: "表明" },
  show: { pos: "v", zh: "表明" },
  shows: { pos: "v", zh: "表明" },
  propose: { pos: "v", zh: "提出" },
  proposed: { pos: "a", zh: "所提出的" },
  model: { pos: "n", zh: "模型" },
  method: { pos: "n", zh: "方法" },
  significant: { pos: "a", zh: "显著的" },
  significantly: { pos: "ad", zh: "显著地" },
  improve: { pos: "v", zh: "提高" },
  improves: { pos: "v", zh: "提高" },
  improved: { pos: "v", zh: "提高" },
  accuracy: { pos: "n", zh: "准确率" },
  collect: { pos: "v", zh: "收集" },
  collected: { pos: "v", zh: "收集" },
  participant: { pos: "n", zh: "参与者" },
  participants: { pos: "n", zh: "参与者" },
  compare: { pos: "v", zh: "比较" },
  compared: { pos: "v", zh: "比较" },
  control: { pos: "n", zh: "对照" },
  group: { pos: "n", zh: "组" },
  gene: { pos: "n", zh: "基因" },
  express: { pos: "v", zh: "表达" },
  expression: { pos: "n", zh: "表达" },
  upregulate: { pos: "v", zh: "上调" },
  upregulates: { pos: "v", zh: "上调" },
  study: { pos: "n", zh: "研究" },
  develop: { pos: "v", zh: "开发" },
  framework: { pos: "n", zh: "框架" },
  integrate: { pos: "v", zh: "整合" },
  address: { pos: "v", zh: "解决" },
  remain: { pos: "v", zh: "仍然" },
  unclear: { pos: "a", zh: "不清楚的" },
  mechanism: { pos: "n", zh: "机制" },
  finding: { pos: "n", zh: "发现" },
  findings: { pos: "n", zh: "发现" },
  provide: { pos: "v", zh: "提供" },
  insight: { pos: "n", zh: "见解" },
  role: { pos: "n", zh: "作用" },
  underlying: { pos: "a", zh: "潜在的" },
  data: { pos: "n", zh: "数据" },
  analysis: { pos: "n", zh: "分析" },
  increase: { pos: "v", zh: "增加" },
  decrease: { pos: "v", zh: "减少" },
  sample: { pos: "n", zh: "样本" },
  perform: { pos: "v", zh: "进行" },
  test: { pos: "n", zh: "检验" },
  statistical: { pos: "a", zh: "统计的" },
  significance: { pos: "n", zh: "显著性" },
};

const lexicon = {
  async lookupWord(word: string) {
    const key = word.toLowerCase();
    const entry = M[key];
    if (!entry) return null;
    return {
      word: key,
      pos: [entry.pos],
      senses: [{ pos: entry.pos, zh: entry.zh, isCore: true, domain: null }],
    };
  },
  async lookupMeta(words: string[]) {
    const map = new Map<string, { pos: string[] }>();
    for (const word of words) {
      const entry = M[word.toLowerCase()];
      if (entry) map.set(word.toLowerCase(), { pos: [entry.pos] });
    }
    return map;
  },
  async lookupLemma(words: string[]) {
    const map = new Map<string, string>();
    for (const word of words) {
      const lower = word.toLowerCase();
      let lemma = lower;
      if (lower === "compared") lemma = "compare";
      if (lower.endsWith("s") && M[lower.slice(0, -1)])
        lemma = lower.slice(0, -1);
      if (lower.endsWith("ed") && M[lower.slice(0, -2)])
        lemma = lower.slice(0, -2);
      if (lower.endsWith("ing") && M[lower.slice(0, -3)])
        lemma = lower.slice(0, -3);
      map.set(lower, lemma);
    }
    return map;
  },
  async lookupPhrases() {
    return new Map<string, string>();
  },
};

const samples = [
  "The results suggest that the proposed model significantly improves accuracy.",
  "We propose a novel framework that integrates A with B to address C.",
  "Although the underlying mechanism remains unclear, these findings provide new insights into the role of X.",
  "Samples were collected from 120 participants between March and June 2024.",
  "The expression of gene X was significantly upregulated compared with the control group.",
  "In this study, we develop a framework that integrates A with B.",
  "It is important to note that the method is effective.",
  "There are several limitations in this study.",
  "The performance of the proposed method was evaluated on a public dataset.",
  "Compared with the baseline, our approach significantly reduces the error.",
];

test("engine samples", async () => {
  for (const sentence of samples) {
    const zh = await translateText(sentence, lexicon as any);
    console.log(`EN: ${sentence}`);
    console.log(`ZH: ${zh}\n`);
  }
});
