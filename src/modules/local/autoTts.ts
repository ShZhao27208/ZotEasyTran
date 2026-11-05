import type { TranslateTask } from "../../utils/task";
import { getPref } from "../../utils/prefs";
import { getTtsRate, speak } from "./tts";
import { getSpeechWindow } from "./ttsWindow";

/**
 * Attach a local TTS request to a finished task and, for reader selections,
 * start playback immediately.
 *
 * Only `text` tasks (i.e. an actual PDF selection) auto-play; titles,
 * abstracts, notes and annotation comments stay silent.
 */
export function attachTts(data: Required<TranslateTask>, text: string): void {
  const clean = String(text || "").trim();
  if (!clean) return;

  const rate = getTtsRate();
  data.tts = [{ text: clean, lang: "en-US", rate }];

  if (data.type !== "text") return;
  if (!getPref("local.autoPlay")) return;
  try {
    Zotero.debug(`[ZotEasyTran] autoplay ${data.type}`);
  } catch {
    // ignore
  }

  const win = getSpeechWindow();
  if (win) {
    speak(clean, { win, lang: "en-US", rate });
  } else {
    try {
      Zotero.debug("[ZotEasyTran] no speech-capable window for autoplay");
    } catch {
      // ignore
    }
  }
}

/** Replay the local TTS of an existing task (used on cache hits). */
export function replayTaskTts(task: {
  tts?: { text: string; lang?: string; rate?: number }[];
}): boolean {
  const request = task.tts?.[0];
  if (!request?.text) return false;
  const win = getSpeechWindow();
  if (!win) return false;
  return speak(request.text, {
    win,
    lang: request.lang,
    rate: request.rate,
  });
}
