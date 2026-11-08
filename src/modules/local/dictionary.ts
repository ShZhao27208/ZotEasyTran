import { getPref } from "../../utils/prefs";

export type DictionaryErrorCode = "missing" | "open" | "schema" | "not-found";

export class LocalDictionaryError extends Error {
  public code: DictionaryErrorCode;
  public path?: string;

  constructor(code: DictionaryErrorCode, message: string, path?: string) {
    super(message);
    this.name = "LocalDictionaryError";
    this.code = code;
    this.path = path;
  }
}

export interface DictionarySense {
  pos: string | null;
  zh: string;
  domain: string | null;
  isCore: boolean;
  source: string;
}

export interface DictionarySynset {
  id: string;
  pos: string;
  gloss: string;
  lexname: string;
  rank: number;
  zh: string[];
  lemmas: string[];
}

export interface DictionaryEntry {
  word: string;
  wordLc: string;
  phonetic: string;
  phoneticSource: string;
  translation: string;
  definition: string;
  pos: string;
  collins: number;
  oxford: number;
  tag: string;
  bnc: number;
  frq: number;
  exchange: string;
  isPhrase: boolean;
  senses: DictionarySense[];
  forms: string[];
  examples: string[];
  synsets: DictionarySynset[];
  /** Set when the queried surface form was resolved through the lemma table. */
  matchedForm?: string;
}

export interface DictionaryStatus {
  path: string;
  exists: boolean;
  open: boolean;
  words?: number;
  phrases?: number;
  builtAt?: string;
  error?: string;
}

const DEFAULT_SUBDIR = "zoteasytran";
const DEFAULT_FILE = "dictionary.sqlite";

let connection: _ZoteroTypes.DBConnection | null = null;
let connectionPath = "";
let openError: string | undefined;
const wordCache = new Map<string, DictionaryEntry | null>();

export function getDictionaryPath(): string {
  const prefPath = String(getPref("local.dictPath") || "").trim();
  if (prefPath) {
    return prefPath;
  }
  return PathUtils.join(Zotero.DataDirectory.dir, DEFAULT_SUBDIR, DEFAULT_FILE);
}

export function dictionaryFileExists(
  dictionaryPath = getDictionaryPath(),
): boolean {
  try {
    return Zotero.File.pathToFile(dictionaryPath).exists();
  } catch {
    return false;
  }
}

/**
 * Close the external dictionary connection.
 *
 * Zotero's shutdown barrier waits for every SQLite connection to close. An
 * open dictionary.sqlite connection therefore keeps the Zotero process alive
 * after the main window disappears.
 */
export async function closeDictionaryConnection(): Promise<void> {
  const db = connection;
  connection = null;
  connectionPath = "";
  openError = undefined;
  wordCache.clear();
  if (!db) return;
  try {
    await db.closeDatabase(true);
  } catch (error) {
    Zotero.debug(`[ZotEasyTran] close dictionary failed: ${error}`);
  }
}

export async function resetDictionaryConnection(): Promise<void> {
  await closeDictionaryConnection();
}

async function getDictionary(): Promise<_ZoteroTypes.DBConnection> {
  const path = getDictionaryPath();
  if (connection && connectionPath === path) {
    return connection;
  }
  await resetDictionaryConnection();

  if (!dictionaryFileExists(path)) {
    throw new LocalDictionaryError("missing", `本地词典未找到：${path}`, path);
  }

  try {
    connection = new Zotero.DBConnection(path);
    // Validate the schema before any lookup.
    await connection.queryAsync("SELECT key, value FROM meta LIMIT 1");
    connectionPath = path;
    return connection;
  } catch (error) {
    openError = String(error);
    await resetDictionaryConnection();
    throw new LocalDictionaryError(
      "open",
      `无法打开本地词典：${openError}`,
      path,
    );
  }
}

export async function getDictionaryStatus(): Promise<DictionaryStatus> {
  const path = getDictionaryPath();
  const exists = dictionaryFileExists(path);
  if (!exists) {
    return { path, exists: false, open: false, error: openError };
  }
  try {
    const db = await getDictionary();
    const words = Number(
      (await db.valueQueryAsync<number>("SELECT COUNT(*) FROM words")) || 0,
    );
    const phrases = Number(
      (await db.valueQueryAsync<number>(
        "SELECT COUNT(*) FROM words WHERE is_phrase = 1",
      )) || 0,
    );
    const builtAt = String(
      (await db.valueQueryAsync<string>(
        "SELECT value FROM meta WHERE key = 'builtAt'",
      )) || "",
    );
    return { path, exists, open: true, words, phrases, builtAt };
  } catch (error) {
    return {
      path,
      exists,
      open: false,
      error: String(error),
    };
  }
}

function normalizeQuery(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "")
    .replace(/\s+/g, " ");
}

interface WordRow {
  word: string;
  word_lc: string;
  phonetic: string;
  phonetic_source: string;
  translation: string;
  definition: string;
  pos: string;
  collins: number;
  oxford: number;
  tag: string;
  bnc: number;
  frq: number;
  exchange: string;
  is_phrase: number;
}

async function queryWord(
  db: _ZoteroTypes.DBConnection,
  surface: string,
): Promise<WordRow | undefined> {
  const lc = surface.toLowerCase();
  const rows = await db.queryAsync(
    `SELECT word, word_lc, phonetic, phonetic_source, translation, definition,
            pos, collins, oxford, tag, bnc, frq, exchange, is_phrase
       FROM words
      WHERE word_lc = ?
      ORDER BY CASE WHEN word = ? THEN 0 ELSE 1 END,
               CASE WHEN frq = 0 THEN 1 ELSE 0 END,
               frq ASC, bnc ASC
      LIMIT 1`,
    [lc, surface],
  );
  return (rows?.[0] as WordRow | undefined) || undefined;
}

async function queryLemma(
  db: _ZoteroTypes.DBConnection,
  surface: string,
): Promise<{ lemma: string; form: string } | undefined> {
  const rows = await db.queryAsync(
    `SELECT lemma, form FROM forms
      WHERE form_lc = ?
      ORDER BY CASE WHEN form = ? THEN 0 ELSE 1 END, length(lemma) ASC
      LIMIT 1`,
    [surface.toLowerCase(), surface.toLowerCase()],
  );
  const row = rows?.[0] as { lemma: string; form: string } | undefined;
  return row && row.lemma ? row : undefined;
}

async function querySenses(
  db: _ZoteroTypes.DBConnection,
  wordLc: string,
): Promise<DictionarySense[]> {
  const rows = await db.queryAsync(
    `SELECT pos, zh, domain, is_core, source
       FROM senses
      WHERE word_lc = ?
      ORDER BY ord ASC`,
    [wordLc],
  );
  return (rows || []).map((row: any) => ({
    pos: row.pos || null,
    zh: String(row.zh || ""),
    domain: row.domain || null,
    isCore: Number(row.is_core) === 1,
    source: String(row.source || "ecdict"),
  }));
}

async function queryForms(
  db: _ZoteroTypes.DBConnection,
  wordLc: string,
): Promise<string[]> {
  const rows = await db.queryAsync(
    `SELECT DISTINCT form FROM forms
      WHERE lemma = ? AND form <> ?
      ORDER BY length(form) ASC, form ASC
      LIMIT 16`,
    [wordLc, wordLc],
  );
  return (rows || []).map((row: any) => String(row.form));
}

async function querySynsets(
  db: _ZoteroTypes.DBConnection,
  word: string,
): Promise<DictionarySynset[]> {
  const rows = await db.queryAsync(
    `SELECT s.id AS id, s.pos AS pos, s.gloss AS gloss, s.lexname AS lexname,
            sw.rank AS rank
       FROM synset_words sw
       JOIN synsets s ON s.id = sw.synset
      WHERE sw.lang = 'en' AND sw.lemma = ? COLLATE NOCASE
      ORDER BY CASE WHEN sw.rank IS NULL THEN 1 ELSE 0 END, sw.rank ASC
      LIMIT 8`,
    [word],
  );
  const out: DictionarySynset[] = [];
  for (const row of rows || []) {
    const zhRows = await db.queryAsync(
      `SELECT lemma FROM synset_words
        WHERE synset = ? AND lang = 'cmn'
        ORDER BY length(lemma) ASC
        LIMIT 4`,
      [row.id],
    );
    const enRows = await db.queryAsync(
      `SELECT lemma FROM synset_words
        WHERE synset = ? AND lang = 'en' AND lemma <> ? COLLATE NOCASE
        ORDER BY length(lemma) ASC
        LIMIT 10`,
      [row.id, word],
    );
    out.push({
      id: String(row.id),
      pos: String(row.pos || ""),
      gloss: String(row.gloss || ""),
      lexname: String(row.lexname || ""),
      rank: Number(row.rank) || 0,
      zh: (zhRows || []).map((r: any) => String(r.lemma)),
      lemmas: (enRows || []).map((r: any) => String(r.lemma)),
    });
  }
  return out;
}

async function queryExamples(
  db: _ZoteroTypes.DBConnection,
  word: string,
): Promise<string[]> {
  try {
    const rows = await db.queryAsync(
      `SELECT DISTINCT e.en AS en
         FROM synset_examples e
         JOIN synset_words sw ON sw.synset = e.synset
        WHERE sw.lang = 'en' AND sw.lemma = ? COLLATE NOCASE
        ORDER BY length(e.en) ASC
        LIMIT 4`,
      [word],
    );
    return (rows || [])
      .map((row: any) => String(row.en || "").trim())
      .filter((text: string) => text.length >= 8);
  } catch {
    // Older dictionary builds do not have synset_examples.
    return [];
  }
}

function fallbackSenses(translation: string): DictionarySense[] {
  return String(translation || "")
    .split(/[\n,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((zh, index) => ({
      pos: null,
      zh,
      domain: null,
      isCore: index === 0,
      source: "ecdict-raw",
    }));
}

/**
 * Look up a single word or multi-word term.
 *
 * Exact case-insensitive match wins; then lemma resolution via the forms table.
 * Returns null when the term is not in the dictionary.
 */
export async function lookupWord(raw: string): Promise<DictionaryEntry | null> {
  const surface = normalizeQuery(raw);
  if (!surface) return null;

  const cacheKey = surface.toLowerCase();
  if (wordCache.has(cacheKey)) {
    return wordCache.get(cacheKey) || null;
  }

  const db = await getDictionary();

  let row = await queryWord(db, surface);
  let matchedForm: string | undefined;

  const lemma = await queryLemma(db, surface);
  if (lemma && lemma.lemma !== surface.toLowerCase()) {
    const lemmaRow = await queryWord(db, lemma.lemma);
    if (lemmaRow) {
      if (!row) {
        row = lemmaRow;
        matchedForm = surface;
      } else {
        // Inflected forms often have their own thin ECDICT entry
        // ("studies: 研究；学习；学业"). Prefer the richer lemma entry when
        // the surface entry has no frequency/collins data.
        const exactWeak = !row.collins && !row.oxford && !row.frq;
        if (exactWeak) {
          const exactSenses = await querySenses(db, row.word_lc);
          const lemmaSenses = await querySenses(db, lemmaRow.word_lc);
          if (lemmaSenses.length >= exactSenses.length) {
            row = lemmaRow;
            matchedForm = surface;
          }
        }
      }
    }
  }

  if (!row) {
    wordCache.set(cacheKey, null);
    return null;
  }

  const senses = await querySenses(db, row.word_lc);
  const entry: DictionaryEntry = {
    word: row.word,
    wordLc: row.word_lc,
    phonetic: row.phonetic || "",
    phoneticSource: row.phonetic_source || "",
    translation: row.translation || "",
    definition: row.definition || "",
    pos: row.pos || "",
    collins: Number(row.collins) || 0,
    oxford: Number(row.oxford) || 0,
    tag: String(row.tag || ""),
    bnc: Number(row.bnc) || 0,
    frq: Number(row.frq) || 0,
    exchange: row.exchange || "",
    isPhrase: Number(row.is_phrase) === 1,
    senses: senses.length ? senses : fallbackSenses(row.translation),
    forms: await queryForms(db, row.word_lc),
    examples: await queryExamples(db, row.word),
    synsets: await querySynsets(db, row.word),
    matchedForm,
  };
  wordCache.set(cacheKey, entry);
  return entry;
}

/** Read the user glossary from the dictionary database. */
export async function getGlossary(): Promise<
  Array<{
    term: string;
    translation: string;
    domain?: string;
    caseSensitive: boolean;
  }>
> {
  const db = await getDictionary();
  const rows = await db.queryAsync(
    `SELECT term, translation, domain, case_sensitive FROM glossary ORDER BY term ASC`,
  );
  return (rows || []).map((row: any) => ({
    term: String(row.term),
    translation: String(row.translation),
    domain: row.domain ? String(row.domain) : undefined,
    caseSensitive: Number(row.case_sensitive) === 1,
  }));
}

export function getOpenError(): string | undefined {
  return openError;
}

export interface WordMeta {
  word: string;
  pos: string[];
  collins: number;
  frq: number;
  isPhrase: boolean;
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(",");
}

/** Batch lookup of part-of-speech/frequency metadata for sentence tagging. */
export async function lookupMetaBatch(
  words: string[],
): Promise<Map<string, WordMeta>> {
  const unique = [
    ...new Set(words.map((w) => w.toLowerCase()).filter(Boolean)),
  ];
  const result = new Map<string, WordMeta>();
  if (!unique.length) return result;
  const db = await getDictionary();
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const rows = await db.queryAsync(
      `SELECT word_lc, word, pos, collins, frq, is_phrase
         FROM words
        WHERE word_lc IN (${placeholders(chunk.length)})`,
      chunk,
    );
    for (const row of rows || []) {
      const key = String(row.word_lc);
      const current = result.get(key);
      const collins = Number(row.collins) || 0;
      const frq = Number(row.frq) || 0;
      if (
        !current ||
        collins > current.collins ||
        (collins === current.collins &&
          frq > 0 &&
          (current.frq === 0 || frq < current.frq))
      ) {
        result.set(key, {
          word: String(row.word),
          pos: String(row.pos || "")
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
          collins,
          frq,
          isPhrase: Number(row.is_phrase) === 1,
        });
      }
    }
  }
  return result;
}

/** Batch lemma resolution for inflected surface forms. */
export async function lookupLemmaBatch(
  forms: string[],
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(forms.map((w) => w.toLowerCase()).filter(Boolean)),
  ];
  const result = new Map<string, string>();
  if (!unique.length) return result;
  const db = await getDictionary();
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const rows = await db.queryAsync(
      `SELECT form_lc, lemma FROM forms
        WHERE form_lc IN (${placeholders(chunk.length)})
        ORDER BY length(lemma) ASC`,
      chunk,
    );
    for (const row of rows || []) {
      const key = String(row.form_lc);
      if (!result.has(key)) {
        result.set(key, String(row.lemma));
      }
    }
  }
  return result;
}

function cleanPhraseTranslation(translation: string): string {
  const text = String(translation || "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => !line.startsWith("["));
  if (!text) return "";
  return text
    .replace(
      /^(n|v|vt|vi|a|ad|adv|prep|conj|pron|num|art|int|aux|abbr)\.\s*/i,
      "",
    )
    .replace(/[（(][^）)]*的(复数|过去式|过去分词|现在分词)[^）)]*[）)]/g, "")
    .trim();
}

/** Batch lookup of multi-word dictionary translations. */
export async function lookupPhraseBatch(
  candidates: string[],
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(candidates.map((w) => w.toLowerCase()).filter(Boolean)),
  ];
  const result = new Map<string, string>();
  if (!unique.length) return result;
  const db = await getDictionary();
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const rows = await db.queryAsync(
      `SELECT word_lc, translation FROM words
        WHERE is_phrase = 1 AND word_lc IN (${placeholders(chunk.length)})
        ORDER BY collins DESC, frq ASC`,
      chunk,
    );
    for (const row of rows || []) {
      const key = String(row.word_lc);
      if (result.has(key)) continue;
      const zh = cleanPhraseTranslation(String(row.translation || ""));
      if (zh) result.set(key, zh);
    }
  }
  return result;
}

export interface GlossaryImportResult {
  count: number;
  skipped: number;
}

function parseGlossaryLine(line: string): {
  term: string;
  translation: string;
  domain?: string;
  caseSensitive: boolean;
} | null {
  const text = line.replace(/^\uFEFF/u, "").trim();
  if (!text || text.startsWith("#")) return null;
  const parts = text.split(/[,\t]/);
  if (parts.length < 2) return null;
  const term = parts[0].trim();
  const translation = parts[1].trim();
  if (!term || !translation) return null;
  return {
    term,
    translation,
    domain: parts[2]?.trim() || undefined,
    caseSensitive: /^(1|true|yes)$/i.test(parts[3]?.trim() || ""),
  };
}

/**
 * Replace the glossary with the contents of a CSV/TSV text.
 *
 * Expected columns: term, translation, [domain], [caseSensitive]
 */
export async function importGlossaryText(
  text: string,
): Promise<GlossaryImportResult> {
  const db = await getDictionary();
  const lines = String(text || "").split(/\r?\n/);
  const rows: Array<{
    term: string;
    translation: string;
    domain?: string;
    caseSensitive: boolean;
  }> = [];
  let skipped = 0;
  for (const line of lines) {
    if (/^term\s*[,\t]/i.test(line.trim())) continue;
    const row = parseGlossaryLine(line);
    if (row) rows.push(row);
    else if (line.trim() && !/^term\s*[,\t]/i.test(line.trim())) skipped++;
  }

  await db.executeTransaction(async () => {
    await db.queryAsync("DELETE FROM glossary");
    for (const row of rows) {
      await db.queryAsync(
        `INSERT INTO glossary(term_lc, term, translation, domain, case_sensitive)
         VALUES (?, ?, ?, ?, ?)`,
        [
          row.term.toLowerCase(),
          row.term,
          row.translation,
          row.domain || null,
          row.caseSensitive ? 1 : 0,
        ],
      );
    }
  });

  return { count: rows.length, skipped };
}

export async function getGlossaryCount(): Promise<number> {
  const db = await getDictionary();
  const value = await db.valueQueryAsync<number>(
    "SELECT COUNT(*) FROM glossary",
  );
  return Number(value) || 0;
}
