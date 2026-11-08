import pkg from "../../../package.json";
import { getDictionaryStatus, lookupWord } from "./dictionary";
import { formatWordEntry } from "./formatWord";
import { getRealLexicon } from "./realLexicon";
import { translateText } from "./engine";

interface SelfTestResult {
  at: string;
  version: string;
  platform: string;
  dictionary?: unknown;
  lookup?: unknown;
  sentence?: unknown;
  speech?: unknown;
  errors: string[];
}

/**
 * Write a small diagnostic snapshot to <data dir>/zoteasytran/selftest.json.
 *
 * This is intentionally non-fatal: it runs after startup, never blocks the UI,
 * and is the quickest way to verify that the external SQLite dictionary can be
 * opened from inside Zotero.
 */
export async function runSelfTest(): Promise<void> {
  const result: SelfTestResult = {
    at: new Date().toISOString(),
    version: pkg.version,
    platform: `${Zotero.isWin ? "win" : Zotero.isMac ? "mac" : "linux"}`,
    errors: [],
  };

  try {
    result.dictionary = await getDictionaryStatus();
  } catch (error) {
    result.errors.push(`dictionary: ${String(error)}`);
  }

  try {
    const entry = await lookupWord("model");
    result.lookup = entry
      ? {
          word: entry.word,
          phonetic: entry.phonetic,
          phoneticSource: entry.phoneticSource,
          senses: entry.senses.length,
          forms: entry.forms.slice(0, 6),
          preview: formatWordEntry(entry).split("\n").slice(0, 12),
        }
      : null;
  } catch (error) {
    result.errors.push(`lookup: ${String(error)}`);
  }

  try {
    const lexicon = await getRealLexicon();
    result.sentence = await translateText(
      "The results suggest that the proposed model significantly improves accuracy.",
      lexicon,
    );
  } catch (error) {
    result.errors.push(`sentence: ${String(error)}`);
  }

  try {
    const win = Zotero.getMainWindow();
    const voices = win?.speechSynthesis?.getVoices() || [];
    result.speech = {
      available: Boolean(win?.speechSynthesis),
      voiceCount: voices.length,
      english: voices
        .filter((voice) => voice.lang.toLowerCase().startsWith("en"))
        .map((voice) => `${voice.name} (${voice.lang})`)
        .slice(0, 8),
    };
  } catch (error) {
    result.errors.push(`speech: ${String(error)}`);
  }

  try {
    const dir = PathUtils.join(Zotero.DataDirectory.dir, "zoteasytran");
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    await IOUtils.write(
      PathUtils.join(dir, "selftest.json"),
      new TextEncoder().encode(`${JSON.stringify(result, null, 2)}\n`),
    );
  } catch (error) {
    Zotero.logError(error as Error);
  }
}
