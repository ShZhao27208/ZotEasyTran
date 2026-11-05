import { config } from "../../../package.json";

type AnyWindow =
  | (Window & {
      SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
      speechSynthesis?: SpeechSynthesis;
      closed?: boolean;
    })
  | null;

export function getUtteranceCtor(
  win: AnyWindow,
): typeof SpeechSynthesisUtterance | undefined {
  const anyWin = win as any;
  return (
    anyWin?.SpeechSynthesisUtterance ||
    anyWin?.wrappedJSObject?.SpeechSynthesisUtterance
  );
}

export function getSynth(win: AnyWindow): SpeechSynthesis | undefined {
  const anyWin = win as any;
  return anyWin?.speechSynthesis || anyWin?.wrappedJSObject?.speechSynthesis;
}

function hasSpeech(win: AnyWindow): win is Window & {
  SpeechSynthesisUtterance: typeof SpeechSynthesisUtterance;
  speechSynthesis: SpeechSynthesis;
} {
  return Boolean(win && !win.closed && getSynth(win) && getUtteranceCtor(win));
}

/**
 * Chrome windows (the Zotero main window) expose `speechSynthesis` but may not
 * expose the `SpeechSynthesisUtterance` constructor. Reader iframes are content
 * windows and do expose both, so prefer the active reader when speaking.
 */
export function getSpeechWindow(preferred?: Window | null): Window | null {
  const candidates: AnyWindow[] = [];
  candidates.push((preferred || null) as AnyWindow);

  try {
    const addon = (Zotero as any)[config.addonInstance];
    const popupWindow = addon?.data?.popup?.currentPopup?.ownerDocument
      ?.defaultView as AnyWindow;
    if (popupWindow) candidates.push(popupWindow);
  } catch {
    // ignore
  }

  try {
    const main = Zotero.getMainWindow() as any;
    const tabID = main?.Zotero_Tabs?.selectedID;
    if (tabID) {
      const reader = (Zotero.Reader as any).getByTabID?.(tabID);
      const readerWindow = reader?._iframeWindow as AnyWindow;
      if (readerWindow) candidates.push(readerWindow);
    }
  } catch {
    // ignore
  }

  candidates.push(Zotero.getMainWindow() as AnyWindow);

  for (const candidate of candidates) {
    if (hasSpeech(candidate)) return candidate as Window;
  }
  return null;
}
