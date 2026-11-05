#!/usr/bin/env node
/**
 * Sanity-check a built dictionary.sqlite.
 *
 * Usage: node scripts/check-dict.mjs [path]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.resolve(
  process.argv[2] || path.join(ROOT, "dist/dictionary.sqlite"),
);

const failures = [];
const check = (ok, message) => {
  if (ok) {
    console.log(`  ok  ${message}`);
  } else {
    console.error(`FAIL  ${message}`);
    failures.push(message);
  }
};

if (!fs.existsSync(file)) {
  console.error(`dictionary not found: ${file}`);
  process.exit(1);
}

const db = new DatabaseSync(file, { readOnly: true });
const one = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);

console.log(
  `checking ${file} (${(fs.statSync(file).size / 1048576).toFixed(1)} MiB)`,
);

const counts = {
  words: one("SELECT COUNT(*) AS n FROM words").n,
  phrases: one("SELECT COUNT(*) AS n FROM words WHERE is_phrase = 1").n,
  senses: one("SELECT COUNT(*) AS n FROM senses").n,
  forms: one("SELECT COUNT(*) AS n FROM forms").n,
  synsets: one("SELECT COUNT(*) AS n FROM synsets").n,
  synsetWords: one("SELECT COUNT(*) AS n FROM synset_words").n,
};
console.log(counts);

check(counts.words > 700000, "words > 700k");
check(counts.phrases > 300000, "phrases > 300k");
check(counts.senses > 900000, "senses > 900k");
check(counts.synsets > 100000, "WordNet synsets > 100k");

for (const [word, minSenses, needsPhonetic] of [
  ["model", 4, true],
  ["run", 5, true],
  ["significant", 3, true],
  ["study", 3, true],
  ["in terms of", 3, false],
]) {
  const row = one(
    "SELECT word, phonetic, phonetic_source, is_phrase FROM words WHERE word_lc = ? LIMIT 1",
    word,
  );
  const senses = one(
    "SELECT COUNT(*) AS n FROM senses WHERE word_lc = ?",
    word,
  ).n;
  check(!!row, `entry exists: ${word}`);
  check(senses >= minSenses, `${word}: senses >= ${minSenses} (got ${senses})`);
  if (needsPhonetic) {
    check(!!row?.phonetic, `${word}: has phonetic (${row?.phonetic})`);
  }
  if (word.includes(" ")) {
    check(row?.is_phrase === 1, `${word}: is_phrase = 1`);
  }
}

const core = one("SELECT COUNT(*) AS n FROM senses WHERE is_core = 1").n;
check(core > 500000, `core senses > 500k (got ${core})`);

const noSense = one(`
  SELECT COUNT(*) AS n FROM words w
  WHERE NOT EXISTS (SELECT 1 FROM senses s WHERE s.word_lc = w.word_lc)
`).n;
check(noSense < 50000, `words without senses < 50k (got ${noSense})`);

const forms = all(
  "SELECT form, lemma FROM forms WHERE lemma = 'study' LIMIT 5",
);
check(forms.length > 0, "study has inflected forms");

db.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
