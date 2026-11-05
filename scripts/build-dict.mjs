#!/usr/bin/env node
/**
 * Build ZotEasyTran's offline dictionary.
 *
 * Sources (default: ../assets, override with ZET_ASSETS):
 *   - ecdict.csv                 ECDICT (MIT) - words, phonetics, Chinese senses
 *   - lemma.en.txt               ECDICT lemma list
 *   - wordnet/                   WordNet 3.0 - synsets, glosses, sense ranks
 *   - omw-1.4/cow/wn-data-cmn.tab Chinese Open Wordnet - synset -> Chinese lemmas
 *   - cmudict.dict               CMU Pronouncing Dictionary - fallback phonetics
 *
 * Output (default: dist/dictionary.sqlite, override with ZET_DB):
 *   - dictionary.sqlite          single-file SQLite database (no WAL sidecars)
 *   - dict-manifest.json         build metadata, counts and source sizes
 *
 * Usage:
 *   node scripts/build-dict.mjs
 *   ZET_ASSETS=/path/to/assets ZET_DB=/path/to/dictionary.sqlite node scripts/build-dict.mjs
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.resolve(
  process.env.ZET_ASSETS || path.join(ROOT, "../assets"),
);
const OUT = path.resolve(
  process.env.ZET_DB || path.join(ROOT, "dist/dictionary.sqlite"),
);
const MANIFEST = path.join(path.dirname(OUT), "dict-manifest.json");

const log = (...args) => console.log("[build-dict]", ...args);
const t0 = Date.now();

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function rmIfExists(file) {
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function fileInfo(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return {
    file: path.relative(ROOT, file),
    size: stat.size,
    sha256: sha256(file),
  };
}

function posGroup(pos) {
  if (!pos) return "";
  switch (pos) {
    case "vt":
    case "vi":
    case "v":
      return "v";
    case "a":
    case "adj":
      return "a";
    case "ad":
    case "adv":
      return "ad";
    default:
      return pos;
  }
}

function normalizePos(pos) {
  const p = pos.toLowerCase();
  if (p === "adj") return "a";
  if (p === "adv") return "ad";
  if (p === "pl") return "n";
  return p;
}

const DOMAIN_LABELS = {
  网络: "网络",
  计: "计算机",
  医: "医学",
  化: "化学",
  法: "法律",
  经: "经济",
  生物: "生物",
  电子: "电子",
  物: "物理",
  数: "数学",
  机: "机械",
  农: "农业",
  军: "军事",
  心: "心理",
  语: "语言",
  建: "建筑",
  冶: "冶金",
  地质: "地质",
  天: "天文",
  航海: "航海",
  体育: "体育",
  音乐: "音乐",
  美术: "美术",
  戏: "戏剧",
  商: "商业",
  会计: "会计",
  统计: "统计",
  自控: "自动化",
  通信: "通信",
  计算机: "计算机",
};

function normalizeDomain(raw) {
  if (!raw) return null;
  const key = raw.trim();
  return DOMAIN_LABELS[key] || key;
}

// ---------------------------------------------------------------------------
// phonetics
// ---------------------------------------------------------------------------

const CMU_TO_IPA = {
  AA: "ɑ",
  AE: "æ",
  AH: "ʌ",
  AO: "ɔ",
  AW: "aʊ",
  AY: "aɪ",
  B: "b",
  CH: "tʃ",
  D: "d",
  DH: "ð",
  EH: "ɛ",
  ER: "ɝ",
  EY: "eɪ",
  F: "f",
  G: "ɡ",
  HH: "h",
  IH: "ɪ",
  IY: "i",
  JH: "dʒ",
  K: "k",
  L: "l",
  M: "m",
  N: "n",
  NG: "ŋ",
  OW: "oʊ",
  OY: "ɔɪ",
  P: "p",
  R: "ɹ",
  S: "s",
  SH: "ʃ",
  T: "t",
  TH: "θ",
  UH: "ʊ",
  UW: "u",
  V: "v",
  W: "w",
  Y: "j",
  Z: "z",
  ZH: "ʒ",
};

const IPA_VOWELS = new Set([
  "ɑ",
  "æ",
  "ʌ",
  "ɔ",
  "aʊ",
  "aɪ",
  "eɪ",
  "ɛ",
  "ɝ",
  "ɚ",
  "ɪ",
  "i",
  "oʊ",
  "ɔɪ",
  "ʊ",
  "u",
  "ə",
  "ɒ",
]);

const IPA_ONSETS = new Set([
  "b",
  "d",
  "f",
  "ɡ",
  "h",
  "j",
  "k",
  "l",
  "m",
  "n",
  "p",
  "ɹ",
  "s",
  "t",
  "v",
  "w",
  "z",
  "ʃ",
  "ʒ",
  "tʃ",
  "dʒ",
  "θ",
  "ð",
  "bl",
  "br",
  "dr",
  "dw",
  "fj",
  "fl",
  "fr",
  "ɡl",
  "ɡr",
  "ɡw",
  "hw",
  "kj",
  "kl",
  "kr",
  "kw",
  "lj",
  "mj",
  "nj",
  "pj",
  "pl",
  "pr",
  "sj",
  "sk",
  "sl",
  "sm",
  "sn",
  "sp",
  "st",
  "sw",
  "tj",
  "tw",
  "θr",
  "ʃr",
  "vj",
  "zj",
  "spr",
  "str",
  "skr",
  "spl",
  "skw",
  "spj",
  "stj",
]);

function tokenizeIpa(ipa) {
  const units = [];
  for (let i = 0; i < ipa.length; ) {
    const two = ipa.slice(i, i + 2);
    if (
      [
        "tʃ",
        "dʒ",
        "aɪ",
        "aʊ",
        "eɪ",
        "oʊ",
        "ɔɪ",
        "əʊ",
        "ɪə",
        "eə",
        "ʊə",
      ].includes(two)
    ) {
      units.push(two);
      i += 2;
    } else {
      units.push(ipa[i]);
      i += 1;
    }
  }
  return units;
}

/**
 * Move stress marks from "before the vowel" to "before the syllable onset".
 * CMU marks stress on the vowel; IPA convention puts it before the onset
 * (ˈmɑ.dəl, sɪɡ.ˈnɪ.fɪ.kənt).
 */
function fixStress(ipa) {
  const units = tokenizeIpa(ipa);
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (unit !== "ˈ" && unit !== "ˌ") continue;
    // Collect the consonant cluster immediately before the marker.
    let start = i - 1;
    while (
      start >= 0 &&
      units[start] !== "ˈ" &&
      units[start] !== "ˌ" &&
      !IPA_VOWELS.has(units[start])
    ) {
      start--;
    }
    start++;
    const cluster = units.slice(start, i);
    if (!cluster.length) continue;
    // Longest suffix of the cluster that is a valid English onset.
    let onsetLen = 0;
    for (let len = cluster.length; len >= 1; len--) {
      const candidate = cluster.slice(cluster.length - len).join("");
      if (IPA_ONSETS.has(candidate)) {
        onsetLen = len;
        break;
      }
    }
    if (!onsetLen) continue;
    const marker = units.splice(i, 1)[0];
    units.splice(i - onsetLen, 0, marker);
  }
  return units.join("");
}

function cmuToIpa(phones) {
  const tokens = phones.trim().split(/\s+/);
  let raw = "";
  for (const token of tokens) {
    const m = token.match(/^([A-Z]+)([0-2])?$/);
    if (!m) return "";
    const stress = m[2];
    let base = CMU_TO_IPA[m[1]];
    if (!base) return "";
    if (m[1] === "AH" && stress === "0") base = "ə";
    if (m[1] === "ER" && stress === "0") base = "ɚ";
    if (stress === "1") raw += "ˈ";
    else if (stress === "2") raw += "ˌ";
    raw += base;
  }
  if (!raw) return "";
  return `/${fixStress(raw)}/`;
}

function normalizePhonetic(raw) {
  if (!raw) return "";
  let s = String(raw).trim();
  if (!s) return "";
  s = s
    .replace(/ә/g, "ə") // Cyrillic schwa used by ECDICT
    .replace(/'/g, "ˈ")
    .replace(/,/g, "ˌ")
    .replace(/:/g, "ː")
    .replace(/ˈ+/g, "ˈ")
    .replace(/ˌ+/g, "ˌ");
  if (!s.startsWith("/")) s = `/${s}`;
  if (!s.endsWith("/")) s = `${s}/`;
  return s;
}

function loadCmudict(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    if (!line || line.startsWith(";;;")) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    let word = parts[0].toLowerCase();
    if (word.endsWith(")") && word.includes("(")) continue; // alternate pronunciation
    if (map.has(word)) continue;
    const ipa = cmuToIpa(parts.slice(1).join(" "));
    if (ipa) map.set(word, ipa);
  }
  return map;
}

// ---------------------------------------------------------------------------
// CSV stream
// ---------------------------------------------------------------------------

async function* csvRecords(file) {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  let field = "";
  let row = [];
  let inQuotes = false;
  let headers = null;

  const flushRow = function* () {
    // strip a trailing CR on the last field (CRLF input)
    if (row.length) {
      const last = row[row.length - 1];
      if (last.endsWith("\r")) row[row.length - 1] = last.slice(0, -1);
    }
    if (!headers) {
      if (row.some((v) => v !== "")) headers = row.map((h) => h.trim());
      row = [];
      return;
    }
    if (!row.some((v) => v !== "")) {
      row = [];
      return;
    }
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = row[i] ?? "";
    row = [];
    yield obj;
  };

  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (inQuotes) {
        if (c === '"') {
          if (chunk[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        field = "";
        yield* flushRow();
      } else if (c === "\r") {
        // handled at row flush / ignored inside CRLF
      } else {
        field += c;
      }
    }
  }
  if (field.length || row.length) {
    row.push(field);
    field = "";
    yield* flushRow();
  }
}

// ---------------------------------------------------------------------------
// sense parsing
// ---------------------------------------------------------------------------

const SENSE_POS_RE =
  /^(n|v|vt|vi|a|adj|ad|adv|prep|conj|pron|num|art|int|aux|abbr|pl)\.\s*/i;
const SENSE_DOMAIN_RE = /^\[([^\]]+)\]\s*/;

function splitSenses(text) {
  const out = [];
  let buf = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "（") depth++;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    if (
      (ch === "," || ch === "，" || ch === ";" || ch === "；") &&
      depth === 0
    ) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function isGrammarNote(text) {
  return /的(过去式|过去分词|现在分词|复数|比较级|最高级|第三人称单数|缩写)/.test(
    text,
  );
}

function parseSenses(word, translation) {
  if (!translation) return [];
  const out = [];
  let ord = 0;
  const normalized = String(translation)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\r/g, "");
  for (const rawLine of normalized.split("\n")) {
    let line = rawLine.trim();
    if (!line) continue;

    // Drop inflection notes embedded in a sense, e.g. "学业（study的复数）".
    line = line
      .replace(
        /[（(][^）)]*(的复数|的过去式|的过去分词|的现在分词|的比较级|的最高级|的第三人称单数|的缩写)[^）)]*[）)]/g,
        "",
      )
      .trim();
    if (!line) continue;

    let domain = null;
    let m = line.match(SENSE_DOMAIN_RE);
    if (m) {
      domain = normalizeDomain(m[1]);
      line = line.slice(m[0].length).trim();
    }

    let pos = null;
    m = line.match(SENSE_POS_RE);
    if (m) {
      pos = normalizePos(m[1]);
      line = line.slice(m[0].length).trim();
    }

    if (!line || isGrammarNote(line)) continue;

    for (const zh of splitSenses(line)) {
      if (!zh) continue;
      // Drop pure English notes that are not Chinese senses (e.g. "abbr. ...").
      if (!/[\u4e00-\u9fff]/.test(zh) && zh.length > 24) continue;
      out.push({
        pos,
        domain,
        zh: zh.replace(/\s+/g, " ").trim(),
        ord: ord++,
        source: domain === "网络" ? "ecdict-web" : "ecdict",
      });
    }
  }

  if (!out.length) return out;

  // Primary part of speech: first non-domain line; fall back to the first sense.
  const primaryPos =
    out.find((s) => s.pos && !s.domain)?.pos || out[0].pos || "";
  let core = 0;
  for (const s of out) {
    if (
      core < 1 &&
      posGroup(s.pos) === posGroup(primaryPos) &&
      !s.domain &&
      s.source === "ecdict"
    ) {
      s.isCore = 1;
      core++;
    }
  }
  if (!core) out[0].isCore = 1;
  return out;
}

// ---------------------------------------------------------------------------
// WordNet + Chinese Open Wordnet
// ---------------------------------------------------------------------------

function loadLexnames(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const [num, name] = line.trim().split(/\t+/);
    if (num && name) map.set(num, name.trim());
  }
  return map;
}

async function buildWordNet(db, assets) {
  const wn = path.join(assets, "wordnet");
  const lexnames = loadLexnames(path.join(wn, "lexnames"));
  const insertSynset = db.prepare(
    "INSERT OR REPLACE INTO synsets(id, pos, gloss, lexname) VALUES (?, ?, ?, ?)",
  );

  const dataFiles = [
    ["data.noun", "n"],
    ["data.verb", "v"],
    ["data.adj", "a"],
    ["data.adv", "r"],
  ];

  let synsetCount = 0;
  db.exec("BEGIN");
  for (const [file, pos] of dataFiles) {
    const full = path.join(wn, file);
    if (!fs.existsSync(full)) continue;
    const rl = readline.createInterface({
      input: fs.createReadStream(full),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line || line.startsWith("  ")) continue;
      const bar = line.indexOf("|");
      if (bar < 0) continue;
      const head = line.slice(0, bar).trim().split(/\s+/);
      const offset = head[0];
      const lexFilenum = head[1];
      const ssType = head[2];
      const idPos = ssType === "s" ? "a" : ssType;
      const id = `${offset}-${idPos}`;
      const gloss = line
        .slice(bar + 1)
        .trim()
        .replace(/\s+/g, " ");
      insertSynset.run(id, idPos, gloss, lexnames.get(lexFilenum) || "");
      synsetCount++;
    }
  }
  db.exec("COMMIT");
  log(`WordNet synsets: ${synsetCount}`);

  // English lemmas with sense ranks from index.sense.
  const senseFile = path.join(wn, "index.sense");
  let enCount = 0;
  if (fs.existsSync(senseFile)) {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO synset_words(synset, lang, lemma, rank) VALUES (?, 'en', ?, ?)",
    );
    const rl = readline.createInterface({
      input: fs.createReadStream(senseFile),
      crlfDelay: Infinity,
    });
    db.exec("BEGIN");
    for await (const line of rl) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const key = parts[0];
      const offset = parts[1];
      const rank = Number.parseInt(parts[2], 10) || 0;
      const pct = key.indexOf("%");
      if (pct <= 0) continue;
      const lemma = key.slice(0, pct).replace(/_/g, " ");
      const posDigit = key[pct + 1];
      const posMap = { 1: "n", 2: "v", 3: "a", 4: "r", 5: "a" };
      const pos = posMap[posDigit];
      if (!pos) continue;
      insert.run(`${offset}-${pos}`, lemma, rank);
      enCount++;
    }
    db.exec("COMMIT");
  }
  log(`WordNet English lemmas: ${enCount}`);

  // Chinese Open Wordnet.
  const cowFile = path.join(assets, "omw-1.4", "cow", "wn-data-cmn.tab");
  let zhCount = 0;
  if (fs.existsSync(cowFile)) {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO synset_words(synset, lang, lemma, rank) VALUES (?, 'cmn', ?, NULL)",
    );
    const rl = readline.createInterface({
      input: fs.createReadStream(cowFile),
      crlfDelay: Infinity,
    });
    db.exec("BEGIN");
    for await (const line of rl) {
      if (!line || line.startsWith("#")) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const synset = parts[0].trim();
      const value = parts[2].trim().replace(/\+/g, "").replace(/\s+/g, " ");
      if (!synset || !value) continue;
      insert.run(synset, value);
      zhCount++;
    }
    db.exec("COMMIT");
  }
  log(`Chinese Open Wordnet lemmas: ${zhCount}`);
}

// ---------------------------------------------------------------------------
// ECDICT
// ---------------------------------------------------------------------------

function parseExchange(word, exchange) {
  const out = [];
  if (!exchange) return out;
  for (const item of String(exchange).split("/")) {
    const idx = item.indexOf(":");
    if (idx <= 0) continue;
    const key = item.slice(0, idx);
    const value = item.slice(idx + 1).trim();
    if (!value) continue;
    if (["s", "p", "d", "i", "3", "r", "t"].includes(key)) {
      out.push({ form: value.toLowerCase(), lemma: word.toLowerCase() });
    }
  }
  return out;
}

async function buildEcdict(db, assets, cmu) {
  const csvFile = path.join(assets, "ecdict.csv");
  if (!fs.existsSync(csvFile)) {
    throw new Error(`ecdict.csv not found at ${csvFile}`);
  }

  const insertWord = db.prepare(`
    INSERT INTO words(
      word, word_lc, phonetic, phonetic_source, translation, definition,
      pos, collins, oxford, tag, bnc, frq, exchange, is_phrase
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSense = db.prepare(`
    INSERT INTO senses(word_lc, pos, ord, zh, domain, is_core, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let words = 0;
  let senses = 0;
  let phrases = 0;
  let phoneticEcdict = 0;
  let phoneticCmu = 0;

  db.exec("BEGIN");
  for await (const row of csvRecords(csvFile)) {
    const word = (row.word || "").trim();
    if (!word) continue;
    const wordLc = word.toLowerCase();

    let phonetic = cmu.get(wordLc) || "";
    let phoneticSource = phonetic ? "cmu" : "";
    if (!phonetic) {
      phonetic = normalizePhonetic(row.phonetic);
      if (phonetic) {
        phoneticSource = "ecdict";
        phoneticEcdict++;
      }
    } else {
      phoneticCmu++;
    }

    const translation = (row.translation || "").trim();
    const senseList = parseSenses(word, translation);
    const posSet = new Set();
    for (const s of senseList) {
      if (s.pos) posSet.add(s.pos);
    }

    insertWord.run(
      word,
      wordLc,
      phonetic,
      phoneticSource,
      translation,
      (row.definition || "").trim(),
      [...posSet].join(","),
      Number.parseInt(row.collins, 10) || 0,
      Number.parseInt(row.oxford, 10) || 0,
      (row.tag || "").trim(),
      Number.parseInt(row.bnc, 10) || 0,
      Number.parseInt(row.frq, 10) || 0,
      (row.exchange || "").trim(),
      word.includes(" ") ? 1 : 0,
    );
    words++;
    if (word.includes(" ")) phrases++;

    for (const s of senseList) {
      insertSense.run(
        wordLc,
        s.pos || null,
        s.ord,
        s.zh,
        s.domain,
        s.isCore || 0,
        s.source,
      );
      senses++;
    }
  }
  db.exec("COMMIT");

  log(
    `ECDICT words: ${words} (phrases ${phrases}); senses: ${senses}; ` +
      `phonetic ecdict=${phoneticEcdict} cmu=${phoneticCmu}`,
  );

  // Forms from ECDICT exchange fields are inserted by the caller, streaming
  // the CSV again would be wasteful; collect them here instead.
  return { words, senses, phrases };
}

async function buildForms(db, assets, cmuUnused) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO forms(form_lc, form, lemma) VALUES (?, ?, ?)",
  );
  let count = 0;

  // ECDICT exchange fields: read CSV once more (cheap relative to DB build).
  const csvFile = path.join(assets, "ecdict.csv");
  db.exec("BEGIN");
  for await (const row of csvRecords(csvFile)) {
    const word = (row.word || "").trim();
    if (!word) continue;
    for (const f of parseExchange(word, row.exchange)) {
      insert.run(f.form, f.form, f.lemma);
      count++;
    }
  }
  db.exec("COMMIT");
  log(`Forms from ECDICT exchange: ${count}`);

  // lemma.en.txt: "lemma/rank -> form1,form2"
  const lemmaFile = path.join(assets, "lemma.en.txt");
  if (fs.existsSync(lemmaFile)) {
    const rl = readline.createInterface({
      input: fs.createReadStream(lemmaFile),
      crlfDelay: Infinity,
    });
    let lemmaCount = 0;
    db.exec("BEGIN");
    for await (const line of rl) {
      if (!line || line.startsWith(";")) continue;
      const m = line.match(/^([^/]+)\/\d+\s*->\s*(.+)$/);
      if (!m) continue;
      const lemma = m[1].trim().toLowerCase();
      const forms = m[2]
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      for (const form of forms) {
        if (form === lemma) continue;
        insert.run(form, form, lemma);
        lemmaCount++;
      }
    }
    db.exec("COMMIT");
    log(`Forms from lemma.en.txt: ${lemmaCount}`);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(ASSETS)) {
    throw new Error(`assets directory not found: ${ASSETS}`);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  rmIfExists(OUT);

  const cmu = loadCmudict(path.join(ASSETS, "cmudict.dict"));
  log(`CMU entries: ${cmu.size}`);

  const db = new DatabaseSync(OUT);
  db.exec("PRAGMA journal_mode = OFF");
  db.exec("PRAGMA synchronous = OFF");
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec("PRAGMA page_size = 4096");

  db.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE words(
      id INTEGER PRIMARY KEY,
      word TEXT NOT NULL,
      word_lc TEXT NOT NULL,
      phonetic TEXT,
      phonetic_source TEXT,
      translation TEXT,
      definition TEXT,
      pos TEXT,
      collins INTEGER DEFAULT 0,
      oxford INTEGER DEFAULT 0,
      tag TEXT,
      bnc INTEGER DEFAULT 0,
      frq INTEGER DEFAULT 0,
      exchange TEXT,
      is_phrase INTEGER DEFAULT 0
    );

    CREATE TABLE senses(
      word_lc TEXT NOT NULL,
      pos TEXT,
      ord INTEGER,
      zh TEXT,
      domain TEXT,
      is_core INTEGER DEFAULT 0,
      source TEXT
    );

    CREATE TABLE forms(
      form_lc TEXT NOT NULL,
      form TEXT NOT NULL,
      lemma TEXT NOT NULL,
      UNIQUE(form_lc, lemma)
    );

    CREATE TABLE synsets(
      id TEXT PRIMARY KEY,
      pos TEXT,
      gloss TEXT,
      lexname TEXT
    );

    CREATE TABLE synset_words(
      synset TEXT NOT NULL,
      lang TEXT NOT NULL,
      lemma TEXT NOT NULL,
      rank INTEGER
    );

    CREATE TABLE glossary(
      term_lc TEXT NOT NULL,
      term TEXT NOT NULL,
      translation TEXT NOT NULL,
      domain TEXT,
      case_sensitive INTEGER DEFAULT 0
    );
  `);

  db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)").run(
    "schemaVersion",
    "1",
  );
  db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)").run(
    "builtAt",
    new Date().toISOString(),
  );

  await buildWordNet(db, ASSETS);
  const counts = await buildEcdict(db, ASSETS, cmu);
  await buildForms(db, ASSETS);

  // Indexes after inserts - much faster.
  db.exec(`
    CREATE INDEX idx_words_word_lc ON words(word_lc);
    CREATE INDEX idx_words_phrase ON words(is_phrase, word_lc);
    CREATE INDEX idx_senses_word ON senses(word_lc);
    CREATE INDEX idx_forms_form ON forms(form_lc);
    CREATE INDEX idx_synset_words_synset ON synset_words(synset, lang);
    CREATE INDEX idx_synset_words_lemma ON synset_words(lang, lemma);
    CREATE INDEX idx_glossary_term ON glossary(term_lc);
  `);

  const count = (table) =>
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  const manifest = {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    database: path.relative(ROOT, OUT),
    size: fs.statSync(OUT).size,
    counts: {
      words: count("words"),
      phrases: db
        .prepare("SELECT COUNT(*) AS n FROM words WHERE is_phrase = 1")
        .get().n,
      senses: count("senses"),
      forms: count("forms"),
      synsets: count("synsets"),
      synsetWordsEn: db
        .prepare("SELECT COUNT(*) AS n FROM synset_words WHERE lang = 'en'")
        .get().n,
      synsetWordsZh: db
        .prepare("SELECT COUNT(*) AS n FROM synset_words WHERE lang = 'cmn'")
        .get().n,
    },
    sources: {
      ecdict: fileInfo(path.join(ASSETS, "ecdict.csv")),
      lemma: fileInfo(path.join(ASSETS, "lemma.en.txt")),
      wordnet: fileInfo(path.join(ASSETS, "wordnet", "data.noun")),
      cow: fileInfo(path.join(ASSETS, "omw-1.4", "cow", "wn-data-cmn.tab")),
      cmudict: fileInfo(path.join(ASSETS, "cmudict.dict")),
    },
    buildMs: Date.now() - t0,
  };

  db.exec("PRAGMA optimize");
  db.close();

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  log(
    `done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT} ` +
      `(${(manifest.size / 1048576).toFixed(1)} MiB)`,
  );
  log(JSON.stringify(manifest.counts));
}

main().catch((error) => {
  console.error("[build-dict] failed:", error);
  process.exitCode = 1;
});
