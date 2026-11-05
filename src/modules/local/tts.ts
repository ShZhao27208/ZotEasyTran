import { getPref } from "../../utils/prefs";
import { getSpeechWindow, getSynth, getUtteranceCtor } from "./ttsWindow";

export interface SpeakOptions {
  win?: Window | null;
  lang?: string;
  rate?: number;
  voiceName?: string;
}

interface QueueState {
  win: Window | null;
  synth: SpeechSynthesis | null;
  queue: string[];
  generation: number;
}

const state: QueueState = {
  win: null,
  synth: null,
  queue: [],
  generation: 0,
};

const MAX_CHUNK = 220;
const DEFAULT_LANG = "en-US";

export function getTtsRate(): number {
  const value = Number.parseFloat(String(getPref("local.rate") || "0.95"));
  if (!Number.isFinite(value)) return 0.95;
  return Math.min(2, Math.max(0.5, value));
}

export function stopTts(): void {
  state.generation++;
  state.queue = [];
  const synth = state.synth;
  state.synth = null;
  state.win = null;
  if (!synth) return;
  try {
    synth.cancel();
  } catch {
    // A closed window can throw; nothing to clean up.
  }
}

function pickVoice(
  synth: SpeechSynthesis,
  lang: string,
  voiceName?: string,
): SpeechSynthesisVoice | null {
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = synth.getVoices();
  } catch {
    return null;
  }
  if (!voices.length) return null;
  if (voiceName) {
    const exact = voices.find((voice) => voice.name === voiceName);
    if (exact) return exact;
  }
  const base = lang.split("-")[0].toLowerCase();
  const sameBase = voices.filter(
    (voice) => voice.lang.split("-")[0].toLowerCase() === base,
  );
  if (!sameBase.length) return null;
  const exactLang = sameBase.find(
    (voice) => voice.lang.toLowerCase() === lang.toLowerCase(),
  );
  return exactLang || sameBase[0];
}

/** Split long paragraphs so each utterance stays well below engine limits. */
export function splitForSpeech(text: string, max = MAX_CHUNK): string[] {
  const cleaned = String(text || "")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  const sentences = cleaned
    .split(/(?<=[.!?;:])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];

  for (const sentence of sentences.length ? sentences : [cleaned]) {
    if (sentence.length <= max) {
      chunks.push(sentence);
      continue;
    }
    let buffer = "";
    for (const word of sentence.split(/\s+/)) {
      if (!buffer) {
        buffer = word;
      } else if (`${buffer} ${word}`.length <= max) {
        buffer += ` ${word}`;
      } else {
        chunks.push(buffer);
        buffer = word;
      }
    }
    if (buffer) chunks.push(buffer);
  }
  return chunks;
}

/**
 * Speak English text with the system's offline speech synthesis.
 *
 * Starts from the beginning every time: any currently playing speech is
 * cancelled, so the same button can be pressed repeatedly for replay.
 */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  const chunks = splitForSpeech(text);
  if (!chunks.length) return false;

  let win = options.win || getSpeechWindow();
  if (!win || !getUtteranceCtor(win)) {
    win = getSpeechWindow(win || Zotero.getMainWindow());
  }
  const synth = getSynth(win);
  const UtteranceCtor = getUtteranceCtor(win);
  if (!win || !synth || !UtteranceCtor) {
    try {
      Zotero.debug(
        "[ZotEasyTran] no SpeechSynthesisUtterance in this window; TTS skipped",
      );
    } catch {
      // ignore
    }
    return false;
  }

  stopTts();
  const generation = state.generation;
  // Debug output only; never logs full paragraphs.
  try {
    Zotero.debug(
      `[ZotEasyTran] tts ${chunks.length} chunk(s): ${chunks[0].slice(0, 60)}`,
    );
  } catch {
    // ignore
  }
  state.win = win;
  state.synth = synth;
  state.queue = chunks;

  const lang = options.lang || DEFAULT_LANG;
  const rate = options.rate ?? getTtsRate();
  const voiceName =
    options.voiceName || String(getPref("local.voice") || "").trim();
  const voice = pickVoice(synth, lang, voiceName || undefined);

  const next = () => {
    if (generation !== state.generation) return;
    const chunk = state.queue.shift();
    if (!chunk) {
      state.synth = null;
      return;
    }
    const utterance = new UtteranceCtor(chunk);
    utterance.lang = lang;
    utterance.rate = rate;
    if (voice) utterance.voice = voice;
    utterance.onend = () => next();
    utterance.onerror = () => {
      if (generation === state.generation) next();
    };
    try {
      synth.speak(utterance);
    } catch {
      state.synth = null;
    }
  };
  next();
  return true;
}

export function isSpeaking(): boolean {
  return Boolean(state.synth?.speaking);
}
