import type { DictionaryEntry, DictionarySense } from "./dictionary";

const POS_LABEL: Record<string, string> = {
  n: "n.",
  v: "v.",
  vt: "vt.",
  vi: "vi.",
  a: "a.",
  ad: "ad.",
  adv: "ad.",
  prep: "prep.",
  conj: "conj.",
  pron: "pron.",
  num: "num.",
  art: "art.",
  int: "int.",
  aux: "aux.",
  abbr: "abbr.",
};

const POS_ORDER = [
  "n",
  "v",
  "vt",
  "vi",
  "a",
  "ad",
  "adv",
  "prep",
  "conj",
  "pron",
  "num",
  "art",
  "int",
  "aux",
  "abbr",
];

function posRank(pos: string | null): number {
  if (!pos) return POS_ORDER.length + 1;
  const index = POS_ORDER.indexOf(pos);
  return index === -1 ? POS_ORDER.length : index;
}

function posLabel(pos: string | null): string {
  if (!pos) return "";
  return POS_LABEL[pos] || `${pos}.`;
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function joinSenses(senses: DictionarySense[]): string {
  return unique(senses.map((sense) => sense.zh)).join("；");
}

function normalizeMultiline(text: string): string {
  return String(text || "")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .trim();
}

function header(entry: DictionaryEntry): string {
  const parts = [entry.word];
  if (entry.phonetic) {
    parts.push(entry.phonetic);
  }
  if (entry.collins > 0) {
    parts.push(
      "★".repeat(Math.min(5, entry.collins)) +
        "☆".repeat(Math.max(0, 5 - entry.collins)),
    );
  }
  let line = parts.join("  ");
  if (entry.matchedForm && entry.matchedForm !== entry.word) {
    line += `\n（由 ${entry.matchedForm} 还原）`;
  }
  return line;
}

function renderGroup(
  pos: string | null,
  senses: DictionarySense[],
  showLabels: boolean,
): string {
  const label = posLabel(pos);
  const core = senses.filter((s) => s.isCore);
  const extended = senses.filter((s) => !s.isCore);
  const segments: string[] = [];
  if (core.length) {
    segments.push(
      showLabels ? `【本义】${joinSenses(core)}` : joinSenses(core),
    );
  }
  if (extended.length) {
    segments.push(
      showLabels ? `【引申】${joinSenses(extended)}` : joinSenses(extended),
    );
  }
  const text = segments.filter(Boolean).join("  ");
  if (!text) return "";
  return label ? `${label} ${text}` : text;
}

/**
 * Format a dictionary entry for the reader popup / side panel.
 *
 * Layout:
 *   word  /phonetic/  ★★★★
 *   n. 【本义】模型  【引申】模范；模特儿
 *   vt. 使模仿；塑造
 *   [计算机] 模型
 *   词形：models / modelled / modelling
 */
export function formatWordEntry(
  entry: DictionaryEntry,
  options: { showSenses?: boolean } = {},
): string {
  const showSenses = options.showSenses !== false;

  if (entry.isPhrase) {
    const lines = [header(entry), normalizeMultiline(entry.translation)].filter(
      Boolean,
    );
    return lines.join("\n");
  }

  const lines: string[] = [header(entry)];
  if (!showSenses) {
    lines.push(normalizeMultiline(entry.translation));
    return lines.filter(Boolean).join("\n");
  }

  const grouped = new Map<string, DictionarySense[]>();
  const domains = new Map<string, DictionarySense[]>();
  const web: DictionarySense[] = [];

  for (const sense of entry.senses) {
    if (sense.domain === "网络" || sense.source === "ecdict-web") {
      web.push(sense);
      continue;
    }
    if (sense.domain) {
      const list = domains.get(sense.domain) || [];
      list.push(sense);
      domains.set(sense.domain, list);
      continue;
    }
    const key = sense.pos || "";
    const list = grouped.get(key) || [];
    list.push(sense);
    grouped.set(key, list);
  }

  const orderedPos = [...grouped.keys()].sort(
    (a, b) => posRank(a) - posRank(b),
  );
  const showLabels = entry.senses.filter((s) => !s.domain).length > 1;
  for (const pos of orderedPos) {
    const text = renderGroup(pos, grouped.get(pos) || [], showLabels);
    if (text) lines.push(text);
  }

  for (const domain of [...domains.keys()].sort()) {
    const senses = domains.get(domain) || [];
    const text = joinSenses(senses);
    if (text) lines.push(`[${domain}] ${text}`);
  }

  if (web.length) {
    const text = joinSenses(web);
    if (text) lines.push(`[网络] ${text}`);
  }

  // If no senses were parsed at all, fall back to the raw translation so the
  // user still sees something useful.
  if (lines.length === 1) {
    const raw = normalizeMultiline(entry.translation);
    if (raw) lines.push(raw);
  }

  if (entry.forms.length) {
    lines.push(`词形：${entry.forms.slice(0, 10).join(" / ")}`);
  }

  return lines.filter(Boolean).join("\n");
}
