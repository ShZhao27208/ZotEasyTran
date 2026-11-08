import { getPref } from "../../utils/prefs";
import { getSpeechWindow } from "./ttsWindow";

/**
 * Optional local HTTP voice service (GPT-SoVITS / GPT-SoVITS api_v2).
 *
 * The model is not loaded into Zotero. The plugin only talks to the local
 * service, caches the returned WAV, and plays it. Once a text has been
 * synthesized, replay/offline playback uses the WAV cache and never touches
 * the service again.
 */
export interface VoiceServiceOptions {
  win?: Window | null;
  lang?: string;
  rate?: number;
}

interface VoiceProfile {
  api?: string;
  ref_audio_path?: string;
  prompt_text?: string;
  prompt_lang?: string;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  repetition_penalty?: number;
  speed_factor?: number;
  fragment_interval?: number;
  seed?: number;
  cache_tag?: string;
  timeout?: number;
}

const DEFAULT_API = "http://127.0.0.1:9880/tts";
const DEFAULT_PROFILE = "D:/Amodel/dd/voice.json";
const DEFAULT_REF = "D:/Amodel/dd/dataset/ref/ref_hp90_nl.wav";
const DEFAULT_PROMPT =
  "I think it's something more, something beyond what we see.";

let generation = 0;
let audio: HTMLAudioElement | null = null;
let profileCache: { path: string; value: VoiceProfile } | null = null;
let serviceDownUntil = 0;

export function isVoiceServiceEnabled(): boolean {
  return Boolean(getPref("local.voiceService"));
}

export function stopVoiceService(): void {
  generation++;
  const current = audio;
  audio = null;
  if (current) {
    try {
      current.pause();
      current.removeAttribute("src");
      current.load();
    } catch {
      // ignore
    }
  }
  try {
    (Services as any).sound?.stop?.();
  } catch {
    // not available on all platforms
  }
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function languageOf(text: string, requested?: string): string {
  const lang = String(requested || "").toLowerCase();
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("en")) return "en";
  return /[\u3400-\u9fff]/u.test(text) ? "zh" : "en";
}

async function loadProfile(): Promise<VoiceProfile> {
  const path = String(
    getPref("local.voiceServiceProfile") || DEFAULT_PROFILE,
  ).trim();
  if (profileCache?.path === path) return profileCache.value;
  let value: VoiceProfile = {};
  try {
    if (path && (await IOUtils.exists(path))) {
      value = JSON.parse(await IOUtils.readUTF8(path)) as VoiceProfile;
    }
  } catch (error) {
    Zotero.debug(`[ZotEasyTran] voice profile read failed: ${error}`);
  }
  profileCache = { path, value };
  return value;
}

function cacheDir(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, "zoteasytran", "voice-cache");
}

function cachePathFor(key: string): string {
  return PathUtils.join(cacheDir(), `${key}.wav`);
}

async function readCache(path: string): Promise<Uint8Array | null> {
  try {
    if (!(await IOUtils.exists(path))) return null;
    const data = await IOUtils.read(path);
    return data.byteLength > 44 ? data : null;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function synthesize(
  text: string,
  lang: string,
  rate: number,
): Promise<{ bytes: Uint8Array; path: string } | null> {
  const profile = await loadProfile();
  const api = String(
    getPref("local.voiceServiceUrl") || profile.api || DEFAULT_API,
  ).trim();
  const timeoutSeconds = Math.max(
    5,
    Number(getPref("local.voiceServiceTimeout") || profile.timeout || 20),
  );
  const tag = String(profile.cache_tag || "gptsovits");
  const key = `${fnv1a(`${text}|${lang}|${rate}|${tag}`)}-${lang}-${rate}`;
  const path = cachePathFor(key);
  const cached = await readCache(path);
  if (cached) return { bytes: cached, path };

  if (Date.now() < serviceDownUntil) return null;

  const payload = {
    text,
    text_lang: lang,
    ref_audio_path: profile.ref_audio_path || DEFAULT_REF,
    prompt_text: profile.prompt_text || DEFAULT_PROMPT,
    prompt_lang: profile.prompt_lang || "en",
    text_split_method: "cut3",
    batch_size: 1,
    media_type: "wav",
    streaming_mode: false,
    speed_factor: Number(rate) || 1,
    fragment_interval: Number(profile.fragment_interval) || 0.25,
    seed: Number.isFinite(Number(profile.seed)) ? Number(profile.seed) : 42,
    top_k: Number(profile.top_k) || 15,
    top_p: Number(profile.top_p) || 1,
    temperature: Number(profile.temperature) || 0.5,
    repetition_penalty: Number(profile.repetition_penalty) || 1.35,
  };

  try {
    const xhr = await Zotero.HTTP.request("POST", api, {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      responseType: "arraybuffer",
      timeout: timeoutSeconds * 1000,
      successCodes: [200],
    });
    const buffer = xhr.response as ArrayBuffer;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 45) {
      throw new Error("empty audio response");
    }
    const bytes = new Uint8Array(buffer);
    await IOUtils.makeDirectory(cacheDir(), {
      ignoreExisting: true,
      createAncestors: true,
    });
    await IOUtils.write(path, bytes);
    Zotero.debug(
      `[ZotEasyTran] voice service ${bytes.byteLength} bytes -> ${path}`,
    );
    return { bytes, path };
  } catch (error) {
    // Localhost connection failures should fall back quickly, not block every
    // selection for the full timeout.
    serviceDownUntil = Date.now() + 30_000;
    Zotero.debug(`[ZotEasyTran] voice service unavailable: ${error}`);
    return null;
  }
}

async function playAudio(
  bytes: Uint8Array,
  path: string,
  win: Window,
): Promise<boolean> {
  const dataUrl = `data:audio/wav;base64,${bytesToBase64(bytes)}`;
  let element: HTMLAudioElement | null = null;
  try {
    element = win.document.createElement("audio");
    element.src = dataUrl;
    element.preload = "auto";
    audio = element;
    await element.play();
    return true;
  } catch {
    // Chrome may reject autoplay of an element created after an async request.
    // Fall back to the system sound API (also uses the cached file).
    try {
      const file = Zotero.File.pathToFile(path);
      (Services as any).sound?.play?.(Services.io.newFileURI(file));
      return true;
    } catch {
      return false;
    }
  }
}

/** Synthesize/play through the local GPT-SoVITS service. */
export async function speakViaVoiceService(
  text: string,
  options: VoiceServiceOptions = {},
): Promise<boolean> {
  if (!isVoiceServiceEnabled()) return false;
  const clean = String(text || "").trim();
  if (!clean) return false;
  const win = options.win || getSpeechWindow();
  if (!win) return false;
  const lang = languageOf(clean, options.lang);
  const rate = Number(options.rate) || 1;
  const token = ++generation;

  const audioData = await synthesize(clean, lang, rate);
  if (!audioData || token !== generation) return false;
  return playAudio(audioData.bytes, audioData.path, win);
}
