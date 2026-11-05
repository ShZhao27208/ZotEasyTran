/**
 * ZotEasyTran mechanical English -> Chinese engine (v1).
 *
 * Design goals:
 * - Fully local: only the caller-provided lexicon is used.
 * - Deterministic: rules and a curated academic termbase, no model weights.
 * - Academic first: terminology beats dictionary glosses; numbers, citations,
 *   formulas and abbreviations are protected and restored verbatim.
 *
 * This is a shallow syntactic transfer engine, not a full parser. It handles
 * the sentence patterns that dominate paper abstracts, methods and results.
 */

import { ACADEMIC_PHRASES, ACADEMIC_TERMS } from "./academicTerms.ts";
import { DOMAIN_PHRASES, DOMAIN_TERMS } from "./domainTerms.ts";

export interface EngineSense {
  pos: string | null;
  zh: string;
  isCore: boolean;
  domain: string | null;
}

export interface EngineWord {
  word: string;
  pos: string[];
  senses: EngineSense[];
}

export interface EngineLexicon {
  lookupWord(word: string): Promise<EngineWord | null>;
  lookupPhrases?(phrases: string[]): Promise<Map<string, string>>;
  lookupMeta?(words: string[]): Promise<Map<string, { pos: string[] }>>;
  lookupLemma?(words: string[]): Promise<Map<string, string>>;
  glossary?: Map<string, string>;
}

const TERMS: Record<string, string> = { ...ACADEMIC_TERMS, ...DOMAIN_TERMS };
const PHRASES: Record<string, string> = {
  ...ACADEMIC_PHRASES,
  ...DOMAIN_PHRASES,
};

type Tag =
  | "DET"
  | "PRON"
  | "NOUN"
  | "ADJ"
  | "ADV"
  | "VERB"
  | "AUX"
  | "MODAL"
  | "PREP"
  | "CONJ"
  | "TO"
  | "WH"
  | "NUM"
  | "PUNCT"
  | "OTHER"
  | "PHRASE"
  | "PROTECTED";

interface Tok {
  text: string;
  lower: string;
  lemma: string;
  tag: Tag;
  punct: boolean;
  prot: boolean;
  zh?: string;
}

// ---------------------------------------------------------------------------
// closed-class vocabulary
// ---------------------------------------------------------------------------

const DETERMINERS = new Set(
  "the a an this that these those some any no every each either neither another much many few little several all both such".split(
    " ",
  ),
);

const PRONOUNS = new Set(
  "i we you he she it they me us them my our your his her its their myself ourselves yourself yourselves himself herself itself themselves oneself mine yours hers ours theirs".split(
    " ",
  ),
);

const PREPOSITIONS = new Set(
  "of in on at by for with without from to into onto upon about above across after against along among around as at before behind below beneath beside besides between beyond despite during except inside outside over through throughout toward towards under underneath until up down within via per versus like unlike since using including regarding concerning following given".split(
    " ",
  ),
);

const CONJUNCTIONS = new Set(
  "and or but nor yet so because although though while whereas if unless since as than whether once when where why how that which who whom whose".split(
    " ",
  ),
);

const MODALS = new Set(
  "can could may might must shall should will would ought".split(" "),
);

const BE_FORMS = new Set("be am is are was were been being".split(" "));
const HAVE_FORMS = new Set("have has had having".split(" "));
const DO_FORMS = new Set("do does did done doing".split(" "));
const WH_WORDS = new Set(
  "that which who whom whose when where why how whether".split(" "),
);

const DISCOURSE: Record<string, string> = {
  however: "然而",
  nevertheless: "尽管如此",
  nonetheless: "尽管如此",
  therefore: "因此",
  thus: "因此",
  hence: "因此",
  consequently: "因此",
  moreover: "此外",
  furthermore: "此外",
  additionally: "此外",
  meanwhile: "同时",
  otherwise: "否则",
  instead: "相反",
  overall: "总体上",
  specifically: "具体而言",
  particularly: "尤其",
  notably: "值得注意的是",
  surprisingly: "令人惊讶的是",
  interestingly: "有趣的是",
  importantly: "重要的是",
  finally: "最后",
  first: "首先",
  second: "其次",
  third: "第三",
  similarly: "类似地",
  conversely: "相反",
  accordingly: "相应地",
  alternatively: "或者",
};

const PRONOUN_ZH: Record<string, string> = {
  i: "我",
  we: "我们",
  you: "你",
  he: "他",
  she: "她",
  it: "它",
  they: "它们",
  me: "我",
  us: "我们",
  them: "它们",
  my: "我的",
  our: "我们的",
  your: "你的",
  his: "他的",
  her: "她的",
  its: "它的",
  their: "它们的",
  myself: "我自己",
  ourselves: "我们自己",
  itself: "它自己",
  themselves: "它们自己",
  this: "这",
  these: "这些",
  that: "那",
  those: "那些",
};

const DET_ZH: Record<string, string> = {
  the: "",
  a: "一个",
  an: "一个",
  this: "这",
  that: "那",
  these: "这些",
  those: "那些",
  some: "一些",
  any: "任何",
  no: "没有",
  every: "每个",
  each: "每个",
  either: "任一",
  neither: "两者都不",
  another: "另一个",
  much: "许多",
  many: "许多",
  few: "少数",
  little: "少量",
  several: "若干",
  all: "所有",
  both: "两者",
  such: "这样的",
};

const PREP_ZH: Record<string, string> = {
  of: "的",
  in: "在",
  on: "在",
  at: "在",
  by: "通过",
  for: "为了",
  with: "用",
  without: "没有",
  from: "从",
  to: "向",
  into: "进入",
  onto: "到",
  upon: "在……上",
  about: "关于",
  above: "在……上方",
  across: "跨越",
  after: "在……之后",
  against: "反对",
  along: "沿着",
  among: "在……之中",
  around: "围绕",
  as: "作为",
  before: "在……之前",
  behind: "在……之后",
  below: "在……下方",
  beneath: "在……下方",
  beside: "在……旁边",
  besides: "除……之外",
  between: "在……之间",
  beyond: "超出",
  despite: "尽管",
  during: "在……期间",
  except: "除……之外",
  inside: "在……内部",
  outside: "在……外部",
  over: "在……之上",
  through: "通过",
  throughout: "贯穿",
  toward: "朝向",
  towards: "朝向",
  under: "在……下",
  underneath: "在……下",
  until: "直到",
  up: "向上",
  down: "向下",
  within: "在……内",
  via: "通过",
  per: "每",
  versus: "对比",
  like: "像",
  unlike: "与……不同",
  since: "自……以来",
  using: "使用",
  including: "包括",
  regarding: "关于",
  concerning: "关于",
  following: "在……之后",
  given: "给定",
};

// ---------------------------------------------------------------------------
// text normalization / protection / tokenization
// ---------------------------------------------------------------------------

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/u;

export function normalizeText(raw: string): string {
  return String(raw || "")
    .normalize("NFKC")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/ﬀ/g, "ff")
    .replace(/ﬃ/g, "ffi")
    .replace(/ﬄ/g, "ffl")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/([A-Za-z])-([A-Za-z])/gu, "$1 $2")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, "$1$2")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clean PDF selection artifacts before translation.
 *
 * The upstream concat mode can append several partial selections to one task,
 * and PDF text layers can start mid-sentence. This removes a short lowercase
 * prefix (e.g. "in mobility, wh " before "As strain increased") and collapses
 * immediately repeated chunks ("As strain increased As strain increased").
 */
export function cleanSelectionText(raw: string): string {
  let text = String(raw || "")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return text;

  const leading = text.match(/^([a-z][^.!?]{0,60}?)(?=[A-Z][a-z])/u);
  if (leading) {
    const prefix = leading[1].trim();
    const words = prefix.split(/\s+/).filter(Boolean);
    const lastWord = words[words.length - 1] || "";
    if (words.length <= 8 && (lastWord.length <= 2 || /,$/.test(prefix))) {
      text = text.slice(leading[1].length).trim();
    }
  }

  for (let n = 6; n >= 2; n--) {
    const re = new RegExp(
      `\\b((?:[\\p{L}'-]+\\s+){${n - 1}}[\\p{L}'-]+)[,;:]?\\s+\\1\\b`,
      "giu",
    );
    text = text.replace(re, "$1");
  }

  const sentences = text.split(/(?<=[.!?])\s+/u);
  const deduped: string[] = [];
  for (const sentence of sentences) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      previous.trim().toLowerCase() === sentence.trim().toLowerCase()
    ) {
      continue;
    }
    deduped.push(sentence);
  }
  return deduped.join(" ").trim();
}

export function isMostlyCJK(text: string): boolean {
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/gu) || []).length;
  const letters = (text.match(/\p{L}/gu) || []).length;
  return letters > 0 && cjk / letters > 0.25;
}

interface ProtectedText {
  text: string;
  spans: string[];
}

const PROTECT_PATTERNS: RegExp[] = [
  /https?:\/\/[^\s)]+/gu,
  /\bdoi:\s*10\.\d{4,9}\/\S+/giu,
  /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/giu,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gu,
  /\$[^$]{1,200}\$/gu,
  /\\\([^)]{1,300}\\\)/gu,
  /\\\[[^\]]{1,500}\\\]/gu,
  /\bp\s*[<>=≤≥]\s*0?\.\d+\b/giu,
  /\b[A-Z][a-z]?\d*(?:\+|-)(?![A-Za-z0-9])/gu,
  /\b[A-Z]{2,}[A-Za-z0-9]*(?:-\d+)?\b/gu,
  /\[\d+(?:\s*[-,]\s*\d+)*\]/gu,
  /\((?:[A-Z][A-Za-z.'-]+(?:\s+(?:et al\.?|and|&)\s*[A-Z][A-Za-z.'-]*)?)[^)]{0,60}\b(?:19|20)\d{2}[a-z]?\)/gu,
  /\b\d+(?:[.,]\d+)?\s*(?:%|‰|℃|°C|°F|mm|cm|km|nm|μm|um|m|kg|mg|μg|ug|ng|g|mL|ml|L|μL|ul|s|ms|min|h|Hz|kHz|MHz|GHz|Pa|kPa|MPa|V|mV|kV|A|mA|W|kW|MW|J|kJ|cal|kcal|mol|mM|μM|uM|nM|pM|bp|kb|Mb|GB|MB|KB|Da|kDa|rpm|g\/L|mg\/L|mg\/kg|μg\/mL|IU)(?![A-Za-z])/giu,
  /\b\d+(?:[.,]\d+)?\s*[×x]\s*10\^?-?\d+\b/giu,
  /\b\d+(?:[.,]\d+)?\b/gu,
  /\b[A-Z]{2,8}(?:-\d+)?\b/gu,
  /\b[A-Za-z]{1,6}\d{1,4}[A-Za-z]?\b/gu,
];

const PROTECT_OPEN = "\uE000";
const PROTECT_CLOSE = "\uE001";
const PROTECT_BASE = 0xe100;

function encodePlaceholder(index: number): string {
  return `${PROTECT_OPEN}${String.fromCodePoint(PROTECT_BASE + index)}${PROTECT_CLOSE}`;
}

function decodePlaceholder(char: string): number {
  return (char.codePointAt(0) || PROTECT_BASE) - PROTECT_BASE;
}

const MONTH_NUM: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const MONTH_TEXT =
  "January|February|March|April|May|June|July|August|September|October|November|December";

export function protectSpans(text: string): ProtectedText {
  const spans: string[] = [];
  let out = text;
  const placeholder = (replacement: string) => {
    const index = spans.push(replacement) - 1;
    return encodePlaceholder(index);
  };

  // Date ranges and common date formats become Chinese date strings.
  out = out.replace(
    new RegExp(
      `\\bbetween\\s+(${MONTH_TEXT})\\s+and\\s+(${MONTH_TEXT})\\s+(\\d{4})\\b`,
      "gi",
    ),
    (_m, a: string, b: string, y: string) =>
      placeholder(
        `在${y}年${MONTH_NUM[a.toLowerCase()]}月至${MONTH_NUM[b.toLowerCase()]}月之间`,
      ),
  );
  out = out.replace(
    new RegExp(`\\b(${MONTH_TEXT})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi"),
    (_m, m: string, d: string, y: string) =>
      placeholder(`${y}年${MONTH_NUM[m.toLowerCase()]}月${Number(d)}日`),
  );
  out = out.replace(
    new RegExp(`\\b(${MONTH_TEXT})\\s+(\\d{4})\\b`, "gi"),
    (_m, m: string, y: string) =>
      placeholder(`${y}年${MONTH_NUM[m.toLowerCase()]}月`),
  );

  for (const pattern of PROTECT_PATTERNS) {
    out = out.replace(pattern, (match) => placeholder(match));
  }
  return { text: out, spans };
}

export function restoreSpans(text: string, spans: string[]): string {
  return text.replace(
    /\uE000([\uE100-\uE8FF])\uE001/gu,
    (_match, char: string) => {
      const index = decodePlaceholder(char);
      return spans[index] ?? "";
    },
  );
}

const ABBREVIATIONS = [
  "e.g.",
  "i.e.",
  "et al.",
  "Fig.",
  "Figs.",
  "Eq.",
  "Eqs.",
  "vs.",
  "cf.",
  "ca.",
  "approx.",
  "Ref.",
  "Refs.",
  "No.",
  "Dr.",
  "Mr.",
  "Ms.",
  "Prof.",
  "etc.",
];

export function splitSentences(text: string): string[] {
  let prepared = text;
  for (const abbrev of ABBREVIATIONS) {
    prepared = prepared.split(abbrev).join(abbrev.replace(/\./g, "\uE200"));
  }
  const parts = prepared
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(“"'(])/u)
    .map((part) => part.replace(/\uE200/g, ".").trim())
    .filter(Boolean);
  return parts.length ? parts : [text];
}

const TOKEN_RE =
  /\uE000[\uE100-\uE8FF]\uE001|[\p{L}_][\p{L}\p{N}_'’-]*|\d+(?:[.,]\d+)*%?|[^\s]/gu;

export function tokenize(text: string): Tok[] {
  const tokens: Tok[] = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    const value = match[0];
    const prot = value.startsWith(PROTECT_OPEN);
    const punct =
      !prot && /^[.,;:!?()[\]{}"'“”‘’/\\|<>+=*&^%$#@~`-]$/u.test(value);
    tokens.push({
      text: value,
      lower: value.toLowerCase(),
      lemma: value.toLowerCase(),
      tag: prot ? "PROTECTED" : punct ? "PUNCT" : "OTHER",
      punct,
      prot,
    });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// tagging / lemmatization
// ---------------------------------------------------------------------------

const IRREGULAR_LEMMA: Record<string, string> = {
  am: "be",
  is: "be",
  are: "be",
  was: "be",
  were: "be",
  been: "be",
  being: "be",
  has: "have",
  had: "have",
  having: "have",
  does: "do",
  did: "do",
  done: "do",
  doing: "do",
  children: "child",
  people: "person",
  men: "man",
  women: "woman",
  mice: "mouse",
  teeth: "tooth",
  feet: "foot",
  data: "data",
  analyses: "analysis",
  hypotheses: "hypothesis",
  criteria: "criterion",
  phenomena: "phenomenon",
  indices: "index",
  matrices: "matrix",
  vertices: "vertex",
  better: "good",
  best: "good",
  worse: "bad",
  worst: "bad",
  more: "more",
  most: "most",
  less: "less",
  least: "least",
  wrote: "write",
  written: "write",
  ran: "run",
  found: "find",
  showed: "show",
  shown: "show",
  gave: "give",
  given: "give",
  took: "take",
  taken: "take",
  made: "make",
  said: "say",
  saw: "see",
  seen: "see",
  came: "come",
  went: "go",
  gone: "go",
  knew: "know",
  known: "know",
  thought: "think",
  brought: "bring",
  bought: "buy",
  held: "hold",
  led: "lead",
  met: "meet",
  paid: "pay",
  sent: "send",
  spent: "spend",
  built: "build",
  chose: "choose",
  chosen: "choose",
  drew: "draw",
  drawn: "draw",
  drove: "drive",
  driven: "drive",
  fell: "fall",
  fallen: "fall",
  felt: "feel",
  flew: "fly",
  flown: "fly",
  forgot: "forget",
  forgotten: "forget",
  got: "get",
  gotten: "get",
  grew: "grow",
  grown: "grow",
  heard: "hear",
  kept: "keep",
  left: "leave",
  lost: "lose",
  meant: "mean",
  rose: "rise",
  risen: "rise",
  sought: "seek",
  sold: "sell",
  spoke: "speak",
  spoken: "speak",
  stood: "stand",
  taught: "teach",
  told: "tell",
  understood: "understand",
  won: "win",
  wore: "wear",
  worn: "wear",
};

function ruleLemma(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR_LEMMA[lower]) return IRREGULAR_LEMMA[lower];
  if (lower.length <= 3) return lower;
  if (lower.endsWith("ies") && lower.length > 4)
    return `${lower.slice(0, -3)}y`;
  if (/(?:ches|shes|sses|xes|zes)$/.test(lower)) return lower.slice(0, -2);
  if (lower.endsWith("ses") && lower.length > 4) return lower.slice(0, -2);
  if (lower.endsWith("ing") && lower.length > 5) {
    const stem = lower.slice(0, -3);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) return stem.slice(0, -1);
    return stem;
  }
  if (lower.endsWith("ied") && lower.length > 4)
    return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("ed") && lower.length > 4) {
    const stem = lower.slice(0, -2);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) return stem.slice(0, -1);
    return stem;
  }
  if (lower.endsWith("es") && lower.length > 4) return lower.slice(0, -1);
  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 3) {
    return lower.slice(0, -1);
  }
  return lower;
}

function suffixTag(word: string): Tag | null {
  if (/ly$/.test(word)) return "ADV";
  if (
    /(?:tion|sion|ment|ness|ity|ism|ance|ence|ship|hood|ology|graphy|ics)$/.test(
      word,
    )
  ) {
    return "NOUN";
  }
  if (/(?:ize|ise|ify|ate)$/.test(word)) return "VERB";
  if (/(?:ous|al|ive|able|ible|ic|ical|ary|ent|ant|ful|less)$/.test(word)) {
    return "ADJ";
  }
  if (/(?:ing|ed)$/.test(word)) return "VERB";
  return null;
}

function posGroup(pos: string): string {
  if (pos === "vt" || pos === "vi" || pos === "v") return "v";
  if (pos === "a" || pos === "adj") return "a";
  if (pos === "ad" || pos === "adv") return "ad";
  return pos;
}

async function annotate(tokens: Tok[], lexicon: EngineLexicon): Promise<void> {
  const words = tokens
    .filter((t) => !t.punct && !t.prot && t.tag === "OTHER")
    .map((t) => t.lower);

  const lemmas = lexicon.lookupLemma
    ? await lexicon.lookupLemma(words)
    : new Map<string, string>();
  const metaWords = [...new Set([...words, ...[...lemmas.values()]])];
  const meta = lexicon.lookupMeta
    ? await lexicon.lookupMeta(metaWords)
    : new Map<string, { pos: string[] }>();

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.prot || tok.punct || tok.tag === "PHRASE") continue;
    const lower = tok.lower;

    if (BE_FORMS.has(lower)) {
      tok.tag = "AUX";
      tok.lemma = "be";
      continue;
    }
    if (HAVE_FORMS.has(lower)) {
      tok.tag = "AUX";
      tok.lemma = "have";
      continue;
    }
    if (DO_FORMS.has(lower)) {
      tok.tag = "AUX";
      tok.lemma = "do";
      continue;
    }
    if (MODALS.has(lower)) {
      tok.tag = "MODAL";
      tok.lemma = lower;
      continue;
    }
    if (lower === "to") {
      const nextTok = tokens.slice(i + 1).find((t) => !t.punct && !t.prot);
      const nextPos = nextTok
        ? [
            ...(meta.get(nextTok.lower)?.pos || []),
            ...(meta.get(nextTok.lemma || "")?.pos || []),
          ]
        : [];
      tok.tag =
        nextTok &&
        (nextTok.tag === "VERB" ||
          nextTok.tag === "AUX" ||
          nextTok.tag === "MODAL" ||
          nextPos.some((p) => posGroup(p) === "v"))
          ? "TO"
          : "PREP";
      tok.lemma = "to";
      continue;
    }
    if (lower === "not" || lower === "never" || lower === "n't") {
      tok.tag = "ADV";
      tok.lemma = lower === "n't" ? "not" : lower;
      continue;
    }
    if (/^[A-Z]$/.test(tok.text) && lower !== "i") {
      const next =
        tokens[i + 1] && !tokens[i + 1].punct && !tokens[i + 1].prot
          ? tokens[i + 1]
          : undefined;
      const variable =
        !next ||
        next.tag === "PREP" ||
        next.tag === "CONJ" ||
        ["with", "and", "or", "to", "for", "in", "on", "by", "vs"].includes(
          next.lower,
        );
      if (variable) {
        tok.tag = "NOUN";
        tok.lemma = lower;
      } else {
        tok.tag = "DET";
        tok.lemma = "a";
      }
      continue;
    }
    if (lower === "that") {
      const prev = [...tokens.slice(0, i)]
        .reverse()
        .find((t) => !t.punct && !t.prot);
      if (prev && ["NOUN", "PHRASE", "PRON"].includes(prev.tag)) {
        tok.tag = "WH";
        tok.lemma = "that";
        continue;
      }
      if (prev && ["VERB", "ADJ", "AUX"].includes(prev.tag)) {
        tok.tag = "CONJ";
        tok.lemma = "that";
        continue;
      }
    }
    if (DETERMINERS.has(lower)) {
      tok.tag = "DET";
      tok.lemma = lower;
      continue;
    }
    if (PRONOUNS.has(lower)) {
      tok.tag = "PRON";
      tok.lemma = lower;
      continue;
    }
    if (WH_WORDS.has(lower)) {
      tok.tag = "WH";
      tok.lemma = lower;
      continue;
    }
    if (CONJUNCTIONS.has(lower)) {
      tok.tag = "CONJ";
      tok.lemma = lower;
      continue;
    }
    if (PREPOSITIONS.has(lower)) {
      tok.tag = "PREP";
      tok.lemma = lower;
      continue;
    }
    if (/^\d/.test(lower)) {
      tok.tag = "NUM";
      tok.lemma = lower;
      continue;
    }

    tok.lemma = lemmas.get(lower) || ruleLemma(lower);
    const posList = [
      ...(meta.get(lower)?.pos || []),
      ...(meta.get(tok.lemma)?.pos || []),
    ];
    const groups = new Set(posList.map(posGroup));

    const next =
      tokens[i + 1] && !tokens[i + 1].punct && !tokens[i + 1].prot
        ? tokens[i + 1]
        : undefined;
    const prev = [...tokens.slice(0, i)]
      .reverse()
      .find((t) => !t.punct && !t.prot);

    const nextPos = next ? meta.get(next.lower)?.pos || [] : [];
    const nextIsNoun =
      !!next &&
      (next.tag === "NOUN" ||
        next.tag === "PHRASE" ||
        (nextPos.some((p) => posGroup(p) === "n") &&
          !nextPos.some((p) => posGroup(p) === "a")));

    if (i === 0 && groups.has("n") && groups.has("v")) {
      // Sentence-initial "Samples were..." / "Results suggest..." are subjects.
      tok.tag = /^(compared|based)$/.test(lower) ? "VERB" : "NOUN";
    } else if (
      /-/.test(lower) &&
      next &&
      !next.punct &&
      !["VERB", "AUX", "MODAL"].includes(next.tag)
    ) {
      tok.tag = "ADJ";
    } else if (
      groups.has("v") &&
      (prev?.tag === "TO" || prev?.tag === "MODAL" || prev?.tag === "AUX")
    ) {
      tok.tag = "VERB";
    } else if (
      /(?:ed|en)$/.test(lower) &&
      nextIsNoun &&
      (i === 0 || ["DET", "ADJ", "NUM"].includes(prev?.tag || ""))
    ) {
      tok.tag = "ADJ";
    } else if (
      groups.has("a") &&
      nextIsNoun &&
      (i === 0 || ["DET", "ADJ", "NUM", "ADV"].includes(prev?.tag || ""))
    ) {
      tok.tag = "ADJ";
    } else if (groups.has("ad")) {
      tok.tag = "ADV";
    } else if (groups.has("v") && !groups.has("n")) {
      tok.tag = "VERB";
    } else if (groups.has("n") && !groups.has("v")) {
      tok.tag = "NOUN";
    } else if (groups.has("v") && groups.has("n")) {
      tok.tag = [
        "DET",
        "ADJ",
        "PREP",
        "PRON",
        "NUM",
        "CONJ",
        "WH",
        "PHRASE",
      ].includes(prev?.tag || "")
        ? "NOUN"
        : "VERB";
    } else if (groups.has("a")) {
      tok.tag = "ADJ";
    } else {
      tok.tag = suffixTag(lower) || "NOUN";
    }

    if (
      /^[A-Z]/.test(tok.text) &&
      i > 0 &&
      (tok.tag === "OTHER" || tok.tag === "NOUN")
    ) {
      tok.tag = "NOUN";
    }
  }
}

// ---------------------------------------------------------------------------
// phrase matching
// ---------------------------------------------------------------------------

async function replacePhrases(
  tokens: Tok[],
  lexicon: EngineLexicon,
): Promise<Tok[]> {
  const wordIdx = tokens
    .map((t, i) => (!t.punct && !t.prot ? i : -1))
    .filter((i) => i >= 0);
  if (wordIdx.length < 2) return tokens;

  const candidates: string[] = [];
  for (let a = 0; a < wordIdx.length; a++) {
    let phrase = "";
    for (let b = a; b < Math.min(wordIdx.length, a + 8); b++) {
      phrase = phrase
        ? `${phrase} ${tokens[wordIdx[b]].lower}`
        : tokens[wordIdx[b]].lower;
      if (b > a) candidates.push(phrase);
    }
  }

  const dictionaryPhrases = lexicon.lookupPhrases
    ? await lexicon.lookupPhrases(candidates)
    : new Map<string, string>();

  const glossary = lexicon.glossary;
  const consumed = new Set<number>();
  const out: Tok[] = [];

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].punct || tokens[i].prot || consumed.has(i)) {
      out.push(tokens[i]);
      continue;
    }

    let best: { end: number; zh: string; key: string } | null = null;
    let key = "";
    let lastIndex = i;
    for (let n = 1; n <= 8 && i + n <= tokens.length; n++) {
      const slice = tokens.slice(i, i + n);
      if (slice.some((t) => t.punct || t.prot)) break;
      key = slice.map((t) => t.lower).join(" ");
      lastIndex = i + n - 1;
      if (n === 1) continue;

      const glossaryZh = glossary?.get(key);
      const academicZh = PHRASES[key];
      const patternLike = (zh?: string) => !!zh && /(?:\.\.\.|……|…)/.test(zh);
      if (glossaryZh && !patternLike(glossaryZh)) {
        best = { end: lastIndex, zh: glossaryZh, key };
      } else if (academicZh && !patternLike(academicZh)) {
        best = { end: lastIndex, zh: academicZh, key };
      } else if (!best && dictionaryPhrases.get(key)) {
        const zh = dictionaryPhrases.get(key)!;
        if (!patternLike(zh)) {
          best = { end: lastIndex, zh, key };
        }
      }
      // Keep searching: a longer glossary/academic match wins.
    }

    if (best) {
      out.push({
        text: tokens
          .slice(i, best.end + 1)
          .map((t) => t.text)
          .join(" "),
        lower: best.key,
        lemma: best.key,
        tag: "PHRASE",
        punct: false,
        prot: false,
        zh: best.zh,
      });
      for (let k = i; k <= best.end; k++) consumed.add(k);
      i = best.end;
    } else {
      out.push(tokens[i]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// translation
// ---------------------------------------------------------------------------

const CJK_SPACE_BEFORE = /([\u3400-\u4dbf\u4e00-\u9fff])([A-Za-z0-9])/gu;
const CJK_SPACE_AFTER = /([A-Za-z0-9])([\u3400-\u4dbf\u4e00-\u9fff])/gu;

export function postprocess(text: string): string {
  return text
    .replace(/,/g, "，")
    .replace(/;/g, "；")
    .replace(/:/g, "：")
    .replace(/\?/g, "？")
    .replace(/!/g, "！")
    .replace(/\.(?=\s|$)/g, "。")
    .replace(/的的/g, "的")
    .replace(/了了/g, "了")
    .replace(/，，/g, "，")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；：？！])/g, "$1")
    .replace(CJK_SPACE_BEFORE, "$1 $2")
    .replace(CJK_SPACE_AFTER, "$1 $2")
    .replace(/(\d)\s+([年月日页图表节章条个次种])/g, "$1$2")
    .replace(/([年月日页图表节章条个次种])\s+(\d)/g, "$1$2")
    .trim();
}

function withPunctuation(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[。！？；：]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

class Translator {
  private cache = new Map<string, string>();

  private lexicon: EngineLexicon;

  constructor(lexicon: EngineLexicon) {
    this.lexicon = lexicon;
  }

  async translate(raw: string): Promise<string> {
    const text = normalizeText(raw);
    if (!text) return "";
    if (isMostlyCJK(text)) return text;

    const protectedText = protectSpans(text);
    const sentences = splitSentences(protectedText.text);
    const translated: string[] = [];
    for (const sentence of sentences) {
      const covered = await this.translateSentence(sentence);
      if (covered) translated.push(covered);
    }
    const joined = translated.join("\n");
    return postprocess(restoreSpans(joined, protectedText.spans));
  }

  private async translateSentence(sentence: string): Promise<string> {
    const tokens = await replacePhrases(tokenize(sentence), this.lexicon);
    await annotate(tokens, this.lexicon);
    return withPunctuation(await this.translateClause(tokens));
  }

  private async translateClause(tokens: Tok[]): Promise<string> {
    let list = tokens.filter((t) => !t.punct || t.tag !== "PUNCT");
    // Keep punctuation for trailing/leading trimming but drop empty tokens.
    list = tokens.slice();
    while (list.length && list[0].punct) list.shift();
    while (list.length && list[list.length - 1].punct) list.pop();
    if (!list.length) return "";

    // Leading participial / prepositional phrase: "Compared with X, ..."
    if (
      list[0].tag === "VERB" &&
      (/^(compare|compared|base|based)$/.test(list[0].lemma) ||
        /^(compare|compared|base|based)$/.test(list[0].lower)) &&
      list[1]?.tag === "PREP" &&
      ["with", "to", "on"].includes(list[1].lower)
    ) {
      const np = this.takeNP(list, 2);
      const npZh = await this.translateNP(np.tokens);
      let comma = 2 + np.consumed;
      while (comma < list.length && !list[comma].punct) comma++;
      const isBase =
        /^(base|based)$/.test(list[0].lemma) ||
        /^(base|based)$/.test(list[0].lower);
      const head = isBase ? "基于" : "与";
      const tail = isBase ? "" : "相比";
      return `${head}${npZh}${tail}，${await this.translateClause(list.slice(comma + 1))}`;
    }
    if (list[0].lower === "according" && list[1]?.lower === "to" && list[2]) {
      const np = this.takeNP(list, 2);
      let comma = 2 + np.consumed;
      while (comma < list.length && !list[comma].punct) comma++;
      return `根据${await this.translateNP(np.tokens)}，${await this.translateClause(
        list.slice(comma + 1),
      )}`;
    }

    // Leading fixed phrase: "the results show that ..." / "in this study, ..."
    if (list[0].tag === "PHRASE") {
      const zh = list[0].zh || "";
      const rest = list.slice(1);
      if (
        /(?:表明|显示|指出|发现|证明|得出结论|意味着)$/.test(zh) &&
        rest.length
      ) {
        return `${zh}，${await this.translateClause(rest)}`;
      }
      if (
        /^(?:在|根据|基于|由于|与|通过|为了|当|据|从|对|对于|关于)/.test(zh) &&
        rest.length
      ) {
        return `${zh}，${await this.translateClause(rest)}`;
      }
      if (/的是$/.test(zh) && rest.length) {
        return `${zh}，${await this.translateClause(rest)}`;
      }
      if (rest.length) {
        return `${zh}${await this.translateClause(rest)}`;
      }
      return zh;
    }

    // Discourse marker: "However, ..."
    if (list[0].tag === "ADV" && DISCOURSE[list[0].lower] && list.length > 1) {
      return `${DISCOURSE[list[0].lower]}，${await this.translateClause(list.slice(1))}`;
    }

    // Leading subordinator: "Although X, Y"
    if (
      list[0].tag === "CONJ" &&
      /^(although|though|because|since|if|unless|when|while|whereas|as)$/.test(
        list[0].lower,
      )
    ) {
      return this.translateSubordinate(list);
    }

    // Split a main clause at top-level commas so "..., followed by ..." is
    // translated as a second clause instead of being appended word by word.
    const CLAUSE_STARTERS = [
      "followed",
      "which",
      "whereas",
      "while",
      "then",
      "thereby",
      "thus",
      "however",
      "therefore",
      "otherwise",
    ];
    const commaIndexes = list
      .map((t, i) => (t.punct && t.text === "," ? i : -1))
      .filter((i) => {
        if (i < 0) return false;
        const next = list.slice(i + 1).find((t) => !t.punct && !t.prot);
        if (!next) return false;
        const hasVerbBefore = list
          .slice(0, i)
          .some((t) => t.tag === "VERB" || t.tag === "AUX");
        const conjunction =
          ["and", "but", "or"].includes(next.lower) && hasVerbBefore;
        return (
          CLAUSE_STARTERS.some(
            (starter) =>
              next.lower === starter || next.lower.startsWith(`${starter} `),
          ) ||
          conjunction ||
          next.tag === "VERB" ||
          next.tag === "AUX"
        );
      });
    if (commaIndexes.length) {
      const parts: Tok[][] = [];
      let start = 0;
      for (const index of commaIndexes) {
        parts.push(list.slice(start, index));
        start = index + 1;
      }
      parts.push(list.slice(start));
      if (parts.length > 1) {
        const translated: string[] = [];
        for (const part of parts) {
          if (!part.length) continue;
          const zh = await this.translateClause(part);
          if (zh) translated.push(zh);
        }
        if (translated.length > 1) {
          return translated.join("，");
        }
      }
    }

    // "there be" existential
    if (list[0].lower === "there" && list[1]?.tag === "AUX") {
      const rest = list.slice(2);
      const lastToken = rest[rest.length - 1];
      if (lastToken?.tag === "PHRASE" && /^在/.test(lastToken.zh || "")) {
        const np = await this.translateNP(rest.slice(0, -1));
        return `${lastToken.zh}，存在${np}`;
      }
      const prepIndex = rest.findIndex((t) => t.tag === "PREP");
      if (prepIndex > 0) {
        const np = await this.translateNP(rest.slice(0, prepIndex));
        const prep = rest[prepIndex];
        const np2 = this.takeNP(rest, prepIndex + 1);
        const pp = await this.translatePP(prep.lower, np2.tokens);
        return `${pp?.zh || ""}，存在${np}`;
      }
      const np = await this.translateNP(rest);
      return `存在${np}`;
    }

    // "it is ADJ to VP" / "it is ADJ that ..."
    if (
      list[0].lower === "it" &&
      list[1]?.lemma === "be" &&
      list[2]?.tag === "ADJ" &&
      (list[3]?.tag === "TO" || list[3]?.lower === "that")
    ) {
      const adj = await this.wordZh(list[2], "a");
      const clause = list.slice(3);
      const body = await this.translateInfinitiveOrClause(clause);
      return `${body}是${adj}的`;
    }

    const verbIndex = this.findMainVerb(list);
    if (verbIndex < 0) {
      return await this.translateNP(list);
    }

    const subjectTokens = list.slice(0, verbIndex);
    const predicateTokens = list.slice(verbIndex);
    const subjectZh = await this.translateNP(subjectTokens);
    const predicate = await this.translatePredicate(predicateTokens, subjectZh);
    return `${predicate.pre}${subjectZh}${predicate.body}`.trim();
  }

  private async translateSubordinate(list: Tok[]): Promise<string> {
    const word = list[0].lower;
    const map: Record<string, string> = {
      although: "虽然",
      though: "虽然",
      because: "因为",
      since: "由于",
      if: "如果",
      unless: "除非",
      when: "当",
      while: "当",
      whereas: "而",
      as: "随着",
    };
    const zh = map[word] || "";
    let comma = -1;
    for (let i = 1; i < list.length; i++) {
      if (list[i].punct && list[i].text === ",") {
        comma = i;
        break;
      }
    }
    if (comma >= 0) {
      const sub = await this.translateClause(list.slice(1, comma));
      const main = await this.translateClause(list.slice(comma + 1));
      if (word === "when" || word === "while") {
        return `${zh}${sub}时，${main}`;
      }
      return `${zh}${sub}，${main}`;
    }
    const sub = await this.translateClause(list.slice(1));
    return `${zh}${sub}`;
  }

  private findMainVerb(tokens: Tok[]): number {
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.tag !== "VERB" && tok.tag !== "AUX" && tok.tag !== "MODAL") {
        continue;
      }
      if (tok.tag === "VERB" && tokens[i - 1]?.tag === "TO") {
        continue;
      }
      return i;
    }
    return -1;
  }

  private async translateInfinitiveOrClause(tokens: Tok[]): Promise<string> {
    let list = tokens;
    if (list[0]?.tag === "TO") list = list.slice(1);
    if (list[0]?.lower === "that") list = list.slice(1);
    if (!list.length) return "";
    return (await this.translateClause(list)).replace(/。$/, "");
  }

  private async translatePredicate(
    tokens: Tok[],
    subjectZh: string,
  ): Promise<{ pre: string; body: string }> {
    const list = tokens;
    const pre: string[] = [];
    const preVerb: string[] = [];
    const post: string[] = [];
    let modal = "";
    let negation = "";
    let perfect = false;
    let progressive = false;
    let passive = false;
    let agent = "";
    let auxZh = "";
    const adverbs: string[] = [];

    let i = 0;
    // Leading adverbs / negation / auxiliaries / modals.
    while (i < list.length) {
      const tok = list[i];
      if (tok.tag === "ADV" && !["not", "never", "n't"].includes(tok.lower)) {
        if (DISCOURSE[tok.lower]) {
          pre.push(DISCOURSE[tok.lower]);
          i++;
          continue;
        }
        adverbs.push(await this.wordZh(tok, "ad"));
        i++;
        continue;
      }
      if (tok.tag === "ADV" && ["not", "never", "n't"].includes(tok.lower)) {
        negation = tok.lower === "never" ? "从不" : "不";
        i++;
        continue;
      }
      if (tok.tag === "MODAL") {
        modal = await this.modalZh(tok.lower);
        i++;
        continue;
      }
      if (tok.tag === "AUX") {
        const lemma = tok.lemma;
        if (lemma === "be") {
          let look = i + 1;
          while (list[look]?.tag === "ADV") look++;
          const next = list[look];
          if (next?.tag === "VERB" && /ing$/.test(next.lower)) {
            progressive = true;
            auxZh = "正在";
            i++;
            continue;
          }
          if (next && /(?:ed|en)$/.test(next.lower)) {
            passive = true;
            i++;
            continue;
          }
          // Copula: keep "be" as the verb so "is effective" -> 是有效的.
          break;
        }
        if (lemma === "have") {
          perfect = true;
          auxZh = "已经";
          i++;
          continue;
        }
        if (lemma === "do") {
          i++;
          continue;
        }
      }
      break;
    }

    // Main verb (may be "be" itself when there is no following verb).
    const verbTok = list[i];

    let verbZh = "";
    let consumed = i;
    if (verbTok) {
      if (verbTok.lemma === "be") {
        // handled as copula below
        verbZh = "是";
        consumed = i + 1;
      } else if (
        verbTok.tag === "VERB" ||
        verbTok.tag === "AUX" ||
        (passive && verbTok.tag === "ADJ")
      ) {
        verbZh = await this.wordZh(verbTok, "v");
        consumed = i + 1;
      }
    }

    const afterVerb = list.slice(consumed);
    // Passive agent: "by X"
    if (passive) {
      const byIndex = afterVerb.findIndex(
        (t) => t.tag === "PREP" && t.lower === "by",
      );
      if (byIndex >= 0) {
        const npTokens = this.takeNP(afterVerb, byIndex + 1);
        agent = await this.translateNP(npTokens.tokens);
        afterVerb.splice(byIndex, 1 + npTokens.consumed);
      }
    }

    // Object and adverbial phrases.
    let objZh = "";
    let objectEnd = afterVerb.length;
    let seenObjectNoun = false;
    if (afterVerb[0]?.tag === "VERB" || afterVerb[0]?.tag === "AUX") {
      objectEnd = 0;
    }
    for (let k = 0; k < afterVerb.length && objectEnd > 0; k++) {
      const tok = afterVerb[k];
      if (tok.tag === "PREP") {
        if (tok.lower === "of" && seenObjectNoun) {
          continue;
        }
        objectEnd = k;
        break;
      }
      if (tok.tag === "CONJ" || tok.punct) {
        objectEnd = k;
        break;
      }
      if (tok.tag === "TO") {
        objectEnd = k;
        break;
      }
      if (tok.tag === "WH" && !seenObjectNoun && k > 0) {
        objectEnd = k;
        break;
      }
      if (tok.tag === "WH" && seenObjectNoun) {
        // A relative clause belongs to the object NP: keep everything after
        // the relative pronoun so "framework that integrates A with B" is
        // translated as one NP.
        objectEnd = afterVerb.length;
        break;
      }
      if (
        tok.tag === "NOUN" ||
        tok.tag === "PHRASE" ||
        tok.tag === "PRON" ||
        tok.tag === "PROTECTED"
      ) {
        seenObjectNoun = true;
      }
    }
    const copularVerb = /^(remain|become|seem|appear|stay|grow)$/.test(
      verbTok?.lemma || "",
    );
    if (copularVerb && afterVerb[0]?.tag === "ADJ") {
      verbZh = `${verbZh}${(await this.wordZh(afterVerb[0], "a")).replace(/的$/, "")}`;
    }
    const objectTokens = afterVerb.slice(0, objectEnd);
    if (objectTokens.length && !(copularVerb && afterVerb[0]?.tag === "ADJ")) {
      if (
        objectTokens[0].tag === "PHRASE" ||
        objectTokens[0].tag === "NOUN" ||
        objectTokens[0].tag === "PRON" ||
        objectTokens[0].tag === "DET" ||
        objectTokens[0].tag === "NUM"
      ) {
        objZh = await this.translateNP(objectTokens);
      } else {
        objZh = await this.translateNP(objectTokens);
      }
    }

    const rest = afterVerb.slice(objectEnd);
    const ppBody: string[] = [];
    const extra: string[] = [];
    for (let k = 0; k < rest.length; k++) {
      const tok = rest[k];
      if (tok.punct) continue;
      if (tok.tag === "PREP") {
        const np = this.takeNP(rest, k + 1);
        const pp = await this.translatePP(tok.lower, np.tokens);
        if (!pp) {
          k += np.consumed;
          continue;
        }
        if (pp.position === "preSubject") pre.push(pp.zh);
        else if (pp.position === "post") post.push(pp.zh);
        else preVerb.push(pp.zh);
        k += np.consumed;
        continue;
      }
      if (
        tok.tag === "VERB" &&
        (/^(compare|compared|base|based)$/.test(tok.lemma) ||
          /^(compare|compared|base|based)$/.test(tok.lower)) &&
        rest[k + 1]?.tag === "PREP" &&
        ["with", "to", "on"].includes(rest[k + 1].lower)
      ) {
        const np = this.takeNP(rest, k + 2);
        const npZh = await this.translateNP(np.tokens);
        const isBase =
          /^(base|based)$/.test(tok.lemma) || /^(base|based)$/.test(tok.lower);
        const zh = isBase ? `基于${npZh}` : `与${npZh}相比`;
        preVerb.push(zh);
        k += 1 + np.consumed;
        continue;
      }
      if (tok.tag === "TO") {
        const vp = await this.translateInfinitiveOrClause(rest.slice(k));
        if (vp) extra.push(`为了${vp}`);
        break;
      }
      if (tok.tag === "WH" || tok.lower === "that") {
        const clause = await this.translateClause(rest.slice(k + 1));
        extra.push(clause.replace(/。$/, ""));
        break;
      }
    }

    // Copula / passive / perfect / modal composition.
    let body = "";
    const adv = adverbs.filter(Boolean).join("");
    const PASSIVE_ZH: Record<string, string> = {
      observe: "观察到",
      find: "发现",
      show: "表明",
      demonstrate: "证明",
      indicate: "表明",
      suggest: "表明",
      report: "报道",
      note: "注意到",
      see: "可见",
      perform: "进行",
      conduct: "开展",
      collect: "收集",
      measure: "测量",
      analyze: "分析",
      assess: "评估",
      evaluate: "评估",
      use: "使用",
    };
    if (passive) {
      const direct = PASSIVE_ZH[verbTok?.lemma || ""];
      body = direct
        ? `${negation}${adv}${direct}${objZh}${perfect ? "了" : ""}`
        : `${negation}${adv}被${agent ? `${agent}` : ""}${verbZh}${perfect ? "了" : ""}${objZh}`;
    } else if (verbTok?.lemma === "be") {
      // "X is ADJ/NP"
      const predZh = objZh || (await this.translateNP(afterVerb));
      if (predZh) {
        body = `${negation}是${adv}${predZh}`;
        if (!/的$/.test(body) && /^[^，。]+$/.test(predZh)) {
          body += "的";
        }
      } else {
        body = `${negation}是`;
      }
    } else {
      const aux = modal || auxZh;
      const verbWithAspect = `${verbZh}${
        !passive && !perfect && /ed$/.test(verbTok?.lower || "") ? "了" : ""
      }`;
      body = `${negation}${aux}${adv}${verbWithAspect}${perfect ? "了" : ""}${objZh}`;
    }

    body = `${preVerb.join("")}${body}${post.join("")}`;
    if (extra.length) body += `，${extra.join("，")}`;
    if (progressive && verbTok?.lemma !== "be") body = `正在${body}`;

    return {
      pre: pre.filter(Boolean).join("，"),
      body,
    };
  }

  private async modalZh(word: string): Promise<string> {
    switch (word) {
      case "can":
      case "could":
        return "能";
      case "may":
      case "might":
        return "可能";
      case "must":
        return "必须";
      case "shall":
      case "should":
        return "应该";
      case "will":
      case "would":
        return "将";
      case "ought":
        return "应该";
      default:
        return "";
    }
  }

  private takeNP(
    tokens: Tok[],
    start: number,
  ): { tokens: Tok[]; consumed: number } {
    let end = start;
    let seenNoun = false;
    while (end < tokens.length) {
      const tok = tokens[end];
      if (
        tok.punct ||
        tok.tag === "CONJ" ||
        tok.tag === "VERB" ||
        tok.tag === "AUX" ||
        tok.tag === "MODAL"
      ) {
        break;
      }
      if (tok.tag === "PREP") {
        // "the role of X" stays one NP; other prepositions start a new PP.
        if (tok.lower === "of" && seenNoun) {
          end++;
          continue;
        }
        break;
      }
      if (
        tok.tag === "NOUN" ||
        tok.tag === "PHRASE" ||
        tok.tag === "PRON" ||
        tok.tag === "PROTECTED"
      ) {
        seenNoun = true;
      }
      end++;
    }
    return { tokens: tokens.slice(start, end), consumed: end - start };
  }

  private async translatePP(
    prep: string,
    npTokens: Tok[],
  ): Promise<{
    zh: string;
    position: "preSubject" | "preVerb" | "post";
  } | null> {
    if (!npTokens.length) return null;
    const np = await this.translateNP(npTokens);
    if (!np) return null;
    switch (prep) {
      case "of":
        return { zh: `${np}的`, position: "post" };
      case "in":
        return { zh: `在${np}中`, position: "preVerb" };
      case "on":
        return { zh: `在${np}上`, position: "preVerb" };
      case "at":
        return { zh: `在${np}`, position: "preVerb" };
      case "during":
        return { zh: `在${np}期间`, position: "preVerb" };
      case "after":
        return { zh: `在${np}之后`, position: "preVerb" };
      case "before":
        return { zh: `在${np}之前`, position: "preVerb" };
      case "by":
        return { zh: `通过${np}`, position: "preVerb" };
      case "with":
        return { zh: `与${np}`, position: "post" };
      case "without":
        return { zh: `没有${np}`, position: "preVerb" };
      case "for":
        return { zh: `对于${np}`, position: "post" };
      case "from":
        return { zh: `从${np}`, position: "preVerb" };
      case "to":
        return { zh: `向${np}`, position: "post" };
      case "into":
        return { zh: `对${np}`, position: "preVerb" };
      case "among":
        return { zh: `在${np}中`, position: "preVerb" };
      case "between":
        return { zh: `在${np}之间`, position: "preVerb" };
      case "under":
        return { zh: `在${np}下`, position: "preVerb" };
      case "over":
        return { zh: `在${np}上`, position: "preVerb" };
      case "through":
      case "via":
        return { zh: `通过${np}`, position: "preVerb" };
      case "per":
        return { zh: `每${np}`, position: "preVerb" };
      case "despite":
        return { zh: `尽管${np}`, position: "preSubject" };
      case "about":
        return { zh: `关于${np}`, position: "preSubject" };
      case "as":
        return { zh: `作为${np}`, position: "preVerb" };
      default:
        return { zh: `${PREP_ZH[prep] || prep}${np}`, position: "preVerb" };
    }
  }

  private async translateNP(tokens: Tok[]): Promise<string> {
    const list = tokens.filter((t) => !t.punct);
    if (!list.length) return "";
    if (list.length === 1) return this.translateToken(list[0], null);

    // Coordination: "A and B".
    const conjIndex = list.findIndex(
      (t) => t.tag === "CONJ" && ["and", "or"].includes(t.lower),
    );
    if (conjIndex > 0 && conjIndex < list.length - 1) {
      const left = await this.translateNP(list.slice(0, conjIndex));
      const right = await this.translateNP(list.slice(conjIndex + 1));
      const conj = list[conjIndex].lower === "or" ? "或" : "和";
      return `${left}${conj}${right}`;
    }

    let start = 0;
    let det = "";
    if (list[start]?.tag === "DET") {
      det = DET_ZH[list[start].lower] ?? "";
      start++;
    }

    // Head noun: last noun/phrase before trailing PPs/relative clauses.
    let headIndex = -1;
    for (let i = start; i < list.length; i++) {
      if (
        list[i].tag === "NOUN" ||
        list[i].tag === "PHRASE" ||
        list[i].tag === "PRON" ||
        list[i].tag === "PROTECTED"
      ) {
        headIndex = i;
      }
      if (list[i].tag === "PREP" || list[i].tag === "WH") break;
    }
    if (headIndex < 0) headIndex = list.length - 1;

    const headTok = list[headIndex];
    const head = await this.translateToken(headTok, "n");

    const modifiers: string[] = [];
    for (let i = start; i < headIndex; i++) {
      const tok = list[i];
      if (tok.tag === "ADJ") {
        modifiers.push(await this.adjectiveZh(tok));
      } else if (tok.tag === "VERB" && /(?:ed|en)$/.test(tok.lower)) {
        const v = await this.wordZh(tok, "v");
        modifiers.push(`所${v}的`);
      } else if (tok.tag === "VERB" && /ing$/.test(tok.lower)) {
        const v = await this.wordZh(tok, "v");
        modifiers.push(`${v}的`);
      } else if (tok.tag === "ADV") {
        const adv = await this.wordZh(tok, "ad");
        if (adv) modifiers.push(adv);
      } else if (tok.tag === "PRON") {
        modifiers.push(PRONOUN_ZH[tok.lower] || "");
      } else if (tok.tag === "NUM" || tok.tag === "PROTECTED") {
        modifiers.push(tok.text);
      } else if (tok.tag === "NOUN" || tok.tag === "PHRASE") {
        modifiers.push(await this.translateToken(tok, "n"));
      }
    }

    // Post-modifiers: PPs and relative clauses.
    const postModifiers: string[] = [];
    let i = headIndex + 1;
    while (i < list.length) {
      const tok = list[i];
      if (tok.tag === "PREP") {
        const np = this.takeNP(list, i + 1);
        const npZh = await this.translateNP(np.tokens);
        if (tok.lower === "of") {
          postModifiers.unshift(`${npZh}的`);
        } else if (
          tok.lower === "in" ||
          tok.lower === "on" ||
          tok.lower === "at"
        ) {
          postModifiers.unshift(
            `${npZh}${tok.lower === "in" ? "中" : tok.lower === "on" ? "上" : ""}的`,
          );
        } else if (tok.lower === "with") {
          postModifiers.unshift(`具有${npZh}的`);
        } else if (tok.lower === "for") {
          postModifiers.unshift(`用于${npZh}的`);
        } else if (tok.lower === "by") {
          postModifiers.unshift(`由${npZh}的`);
        } else {
          postModifiers.unshift(`${PREP_ZH[tok.lower] || ""}${npZh}的`);
        }
        i += 1 + np.consumed;
        continue;
      }
      if (tok.tag === "WH") {
        const clause = await this.translateClause(list.slice(i + 1));
        const clean = clause.replace(/。$/, "");
        if (clean) postModifiers.unshift(`${clean}的`);
        break;
      }
      if (tok.tag === "VERB" && /(?:ed|en)$/.test(tok.lower)) {
        const v = await this.wordZh(tok, "v");
        postModifiers.unshift(`所${v}的`);
        i++;
        continue;
      }
      i++;
    }

    const core = [...postModifiers, ...modifiers, head].filter(Boolean);
    let result = core.join("");
    if (det && !/^[这那哪些每各两]/.test(det)) {
      result = `${det}${result}`;
    } else if (det) {
      result = `${det}${result}`;
    }
    return result || head;
  }

  private async adjectiveZh(tok: Tok): Promise<string> {
    const zh = await this.wordZh(tok, "a");
    if (!zh) return "";
    if (/[的地得]$/.test(zh)) return zh;
    return `${zh}的`;
  }

  private async translateToken(
    tok: Tok,
    prefer: string | null,
  ): Promise<string> {
    if (tok.prot) return tok.text;
    if (tok.tag === "PHRASE") return tok.zh || tok.text;
    if (tok.tag === "NUM") return tok.text;
    if (tok.tag === "PRON") return PRONOUN_ZH[tok.lower] || tok.text;
    if (tok.tag === "DET") return DET_ZH[tok.lower] ?? "";
    if (tok.tag === "PREP") return PREP_ZH[tok.lower] || tok.lower;
    if (tok.tag === "CONJ") {
      const CONJ_ZH: Record<string, string> = {
        and: "和",
        or: "或",
        but: "但是",
        nor: "也不",
        yet: "然而",
        so: "因此",
        as: "随着",
        than: "比",
        that: "",
        whether: "是否",
        while: "而",
        whereas: "而",
        because: "因为",
        although: "虽然",
        if: "如果",
        unless: "除非",
        since: "由于",
        once: "一旦",
      };
      return CONJ_ZH[tok.lower] ?? tok.lower;
    }
    if (tok.tag === "ADV") return this.wordZh(tok, "ad");
    if (tok.tag === "ADJ") return this.wordZh(tok, "a");
    if (tok.tag === "VERB" || tok.tag === "AUX") return this.wordZh(tok, "v");
    return this.wordZh(tok, prefer);
  }

  private async wordZh(tok: Tok, prefer: string | null): Promise<string> {
    if (tok.zh) return tok.zh;
    const key = `${tok.lemma || tok.lower}|${prefer || ""}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const lower = tok.lower;
    const lemma = tok.lemma || lower;
    const glossaryZh =
      this.lexicon.glossary?.get(lower) || this.lexicon.glossary?.get(lemma);
    if (glossaryZh) {
      this.cache.set(key, glossaryZh);
      return glossaryZh;
    }

    const academic =
      prefer === "v"
        ? TERMS[lemma] || TERMS[lower]
        : TERMS[lower] || TERMS[lemma];
    if (academic) {
      this.cache.set(key, academic);
      return academic;
    }

    // A very short token is usually a PDF fragment or abbreviation ("wh",
    // "La"). Expanding it through the dictionary (wh -> watt-hour) is worse
    // than keeping the surface form.
    const SHORT_WORDS = new Set([
      "do",
      "go",
      "up",
      "us",
      "me",
      "my",
      "he",
      "she",
      "it",
      "we",
      "no",
      "so",
      "or",
      "an",
      "as",
      "at",
      "by",
      "in",
      "of",
      "on",
      "to",
      "if",
    ]);
    if (
      lower.length <= 2 &&
      !SHORT_WORDS.has(lower) &&
      !/[A-Z]{2,}/.test(tok.text) &&
      !/\d/.test(tok.text)
    ) {
      this.cache.set(key, tok.text);
      return tok.text;
    }

    let word = await this.lexicon.lookupWord(lemma);
    if (!word && lemma !== lower) {
      word = await this.lexicon.lookupWord(lower);
    }
    const MONTHS: Record<string, string> = {
      january: "1月",
      february: "2月",
      march: "3月",
      april: "4月",
      may: "5月",
      june: "6月",
      july: "7月",
      august: "8月",
      september: "9月",
      october: "10月",
      november: "11月",
      december: "12月",
    };
    if (MONTHS[lower]) {
      this.cache.set(key, MONTHS[lower]);
      return MONTHS[lower];
    }
    if (/^[A-Z]$/.test(tok.text)) {
      this.cache.set(key, tok.text);
      return tok.text;
    }
    if (!word) {
      this.cache.set(key, tok.text);
      return tok.text;
    }

    const candidates = word.senses.filter((sense) => sense.zh);
    const wanted = prefer ? [prefer, prefer === "n" ? "n" : ""] : [];
    const chosen =
      candidates.find(
        (sense) =>
          !sense.domain &&
          wanted.includes(posGroup(sense.pos || "")) &&
          sense.isCore,
      ) ||
      candidates.find(
        (sense) => !sense.domain && wanted.includes(posGroup(sense.pos || "")),
      ) ||
      candidates.find((sense) => !sense.domain) ||
      candidates[0];
    if (!chosen) {
      this.cache.set(key, tok.text);
      return tok.text;
    }
    const zh = chosen.zh
      .replace(/^\s*(?:\[[^\]]+\]|【[^】]*】)\s*/u, "")
      .trim();
    this.cache.set(key, zh);
    return zh;
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export async function translateText(
  raw: string,
  lexicon: EngineLexicon,
): Promise<string> {
  return new Translator(lexicon).translate(raw);
}

/** Debug helper: protected text and annotated tokens. */
export async function debugStages(
  raw: string,
  lexicon: EngineLexicon,
): Promise<{
  protected: ProtectedText;
  tokens: Array<Record<string, unknown>>;
}> {
  const text = normalizeText(raw);
  const protectedText = protectSpans(text);
  const tokens = await replacePhrases(tokenize(protectedText.text), lexicon);
  await annotate(tokens, lexicon);
  return {
    protected: protectedText,
    tokens: tokens.map((t) => ({
      text: t.text,
      lemma: t.lemma,
      tag: t.tag,
      prot: t.prot,
      codes: t.prot
        ? [...t.text].map((c) => (c.codePointAt(0) || 0).toString(16)).join(",")
        : undefined,
      zh: t.zh,
    })),
  };
}

/** Debug helper used by unit tests: surface form, lemma, tag and phrase. */
export async function analyzeText(
  raw: string,
  lexicon: EngineLexicon,
): Promise<Array<{ text: string; lemma: string; tag: string; zh?: string }>> {
  const text = normalizeText(raw);
  const tokens = await replacePhrases(tokenize(text), lexicon);
  await annotate(tokens, lexicon);
  return tokens.map((t) => ({
    text: t.text,
    lemma: t.lemma,
    tag: t.tag,
    zh: t.zh,
  }));
}

export { Translator };
