import type { EngineLexicon, EngineWord } from "./engine";
import {
  lookupLemmaBatch,
  lookupMetaBatch,
  lookupPhraseBatch,
  lookupWord,
  getGlossary,
} from "./dictionary";

let glossaryCache: Map<string, string> | null = null;

export function resetGlossaryCache(): void {
  glossaryCache = null;
}

async function getGlossaryMap(): Promise<Map<string, string>> {
  if (glossaryCache) return glossaryCache;
  try {
    const entries = await getGlossary();
    glossaryCache = new Map(
      entries.map((entry) => [entry.term.toLowerCase(), entry.translation]),
    );
  } catch {
    glossaryCache = new Map();
  }
  return glossaryCache;
}

/**
 * Adapter from the Zotero-side dictionary to the pure engine interface.
 * Keeping the engine free of Zotero imports makes it unit-testable in Node.
 */
export async function getRealLexicon(): Promise<EngineLexicon> {
  const glossary = await getGlossaryMap();
  return {
    async lookupWord(raw: string): Promise<EngineWord | null> {
      const entry = await lookupWord(raw);
      if (!entry) return null;
      return {
        word: entry.word,
        pos: entry.pos
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        senses: entry.senses.map((sense) => ({
          pos: sense.pos,
          zh: sense.zh,
          isCore: sense.isCore,
          domain: sense.domain,
        })),
      };
    },
    lookupMeta: async (words: string[]) => {
      const map = await lookupMetaBatch(words);
      const out = new Map<string, { pos: string[] }>();
      for (const [key, value] of map) {
        out.set(key, { pos: value.pos });
      }
      return out;
    },
    lookupLemma: (words: string[]) => lookupLemmaBatch(words),
    lookupPhrases: (phrases: string[]) => lookupPhraseBatch(phrases),
    glossary,
  };
}
