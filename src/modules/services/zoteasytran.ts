import { getPref } from "../../utils/prefs";
import type { TranslateTask } from "../../utils/task";
import { LocalDictionaryError, lookupWord } from "../local/dictionary";
import { formatWordEntry } from "../local/formatWord";
import { attachTts } from "../local/autoTts";
import { getRealLexicon } from "../local/realLexicon";
import { isMostlyCJK, translateText } from "../local/engine";
import { lookupMaterialsTerm } from "../local/materialsTerms";
import { TranslateService } from "./base";

type TaskData = Required<TranslateTask>;

function describeError(error: unknown): string {
  if (error instanceof LocalDictionaryError) {
    return error.message;
  }
  return `ZotEasyTran: ${String(error)}`;
}

function showSenses(): boolean {
  return Boolean(getPref("local.showSenses"));
}

function wordCount(raw: string): number {
  return String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Sentence/paragraph path, shared by the sentence service and by the word
 * service when it receives a multi-word task (concat mode, annotation text,
 * or a caller that routed a phrase to the dictionary service).
 */
async function translateSentence(data: TaskData): Promise<void> {
  const raw = String(data.raw || "").trim();
  if (!raw) {
    data.result = "";
    return;
  }

  if (isMostlyCJK(raw)) {
    data.result = raw;
    return;
  }

  const looksLikePhrase = wordCount(raw) <= 6 && !/[.!?;:]$/.test(raw);

  if (looksLikePhrase) {
    try {
      const entry = await lookupWord(raw);
      if (entry?.isPhrase) {
        data.result = formatWordEntry(entry, { showSenses: showSenses() });
        attachTts(data, raw);
        return;
      }
    } catch (error) {
      data.result = describeError(error);
      return;
    }
  }

  try {
    const lexicon = await getRealLexicon();
    const translated = (await translateText(raw, lexicon)).trim();
    data.result = translated || `（未生成译文）\n${raw}`;
    Zotero.debug(
      `[ZotEasyTran] sentence ${JSON.stringify(raw.slice(0, 80))} => ${JSON.stringify(data.result.slice(0, 200))}`,
    );
    if (translated) {
      attachTts(data, raw);
    }
  } catch (error) {
    data.result = describeError(error);
  }
}

/**
 * ZotEasyTran word service.
 *
 * Handles a single word-like selection: local dictionary lookup with
 * phonetic, part of speech, primary/extended senses and word forms.
 *
 * If the task contains more than one word (e.g. concat mode appended another
 * selection), it is routed to the sentence engine instead of reporting
 * "未收录".
 */
export const ZotEasyTranDict: TranslateService = {
  id: "zoteasytran-dict",
  type: "word",
  async translate(data) {
    if (wordCount(data.raw) > 1) {
      await translateSentence(data);
      return;
    }
    try {
      const entry = await lookupWord(data.raw);
      const term = lookupMaterialsTerm(data.raw);
      if (!entry) {
        if (term) {
          data.result = `${data.raw.trim()}\n[材料] ${term}\n（本地材料术语表）`;
          attachTts(data, data.raw);
          return;
        }
        data.result = `未收录：${data.raw.trim()}`;
        return;
      }
      data.result = formatWordEntry(entry, { showSenses: showSenses() });
      if (
        term &&
        !data.result.includes(term) &&
        !entry.translation.includes(term)
      ) {
        data.result += `\n[材料] ${term}`;
      }
      Zotero.debug(
        `[ZotEasyTran] word ${JSON.stringify(data.raw.slice(0, 80))} => ${JSON.stringify(data.result.slice(0, 160))}`,
      );
      attachTts(data, data.raw);
    } catch (error) {
      data.result = describeError(error);
    }
  },
};

/**
 * ZotEasyTran sentence/paragraph service.
 *
 * Multi-word selections first get a local phrase lookup; everything else goes
 * through the rule-based English-to-Chinese engine.
 */
export const ZotEasyTranMT: TranslateService = {
  id: "zoteasytran-mt",
  type: "sentence",
  translate: translateSentence,
};
