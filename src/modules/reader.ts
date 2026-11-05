import { config } from "../../package.json";
import { SVGIcon } from "../utils/config";
import { addTranslateAnnotationTask } from "../utils/task";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { speak } from "./local/tts";
import { getSpeechWindow } from "./local/ttsWindow";

const annotationClickBound = new WeakSet<Document>();

export function registerReaderInitializer() {
  // Attach to readers that are already open when the plugin starts, and keep
  // retrying briefly while the nested PDF iframe is still loading.
  const attachExistingReaders = () => {
    try {
      for (const reader of (Zotero.Reader as any)._readers || []) {
        const iframeDoc = reader?._iframeWindow?.document as
          | Document
          | undefined;
        if (iframeDoc) {
          attachAnnotationClickHandler(reader, iframeDoc);
        }
      }
    } catch {
      // ignore
    }
  };
  attachExistingReaders();
  let attachTries = 0;
  const attachTimer = setInterval(() => {
    attachExistingReaders();
    attachTries++;
    if (attachTries >= 20 || !addon.data.alive) {
      clearInterval(attachTimer);
    }
  }, 1000);

  Zotero.Reader.registerEventListener(
    "renderToolbar",
    (event) => {
      attachAnnotationClickHandler(event.reader, event.doc);
      try {
        const iframeDoc = (event.reader as any)?._iframeWindow?.document as
          | Document
          | undefined;
        if (iframeDoc) {
          attachAnnotationClickHandler(event.reader, iframeDoc);
        }
        Zotero.debug(
          `[ZotEasyTran] annotation handler bound: doc=${event.doc?.URL || ""} iframe=${iframeDoc?.URL || ""}`,
        );
      } catch {
        // ignore
      }
    },
    config.addonID,
  );

  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    (event) => {
      const { reader, doc, params, append } = event;
      addon.data.translate.selectedText = params.annotation.text.trim();
      attachAnnotationClickHandler(reader, doc);
      addon.hooks.onReaderPopupShow(event);
    },
    config.addonID,
  );

  Zotero.Reader.registerEventListener(
    "renderSidebarAnnotationHeader",
    (event) => {
      const { reader, doc, params, append } = event;
      const annotationData = params.annotation;
      attachAnnotationClickHandler(reader, doc);

      // TEMP: If not many annotations, create the button immediately
      if (reader._item.numAnnotations() < 1000) {
        append(createTranslateAnnotationButton(doc, reader, annotationData));
        const speakButton = createSpeakAnnotationButton(doc, annotationData);
        if (speakButton) append(speakButton);
        return;
      }

      // TEMP: Use error event to delay the button creation to avoid blocking the main thread
      const placeholder = doc.createElement("img");
      placeholder.src = "chrome://zotero/error.png";
      placeholder.dataset.annotationId = annotationData.id;
      placeholder.dataset.libraryId = reader._item.libraryID.toString();
      placeholder.addEventListener("error", (event) => {
        const placeholder = event.currentTarget as HTMLElement;
        placeholder.ownerGlobal?.requestIdleCallback(() => {
          const annotationID = placeholder.dataset.annotationId;
          const libraryID = parseInt(placeholder.dataset.libraryId || "");
          const button = doc.createElement("div");
          button.classList.add("icon");
          button.innerHTML = SVGIcon;
          button.title = getString("sideBarIcon-title");
          button.addEventListener("click", (e) => {
            const task = addTranslateAnnotationTask(libraryID, annotationID!);
            addon.hooks.onTranslate(task, {
              noCheckZoteroItemLanguage: true,
              noDisplay: true,
            });
            e.preventDefault();
          });
          button.addEventListener("mouseover", (e) => {
            (e.target as HTMLElement).style.backgroundColor =
              "var(--color-sidepane)";
          });
          button.addEventListener("mouseout", (e) => {
            (e.target as HTMLElement).style.removeProperty("background-color");
          });
          placeholder.replaceWith(button);
          const speakButton = createSpeakAnnotationButton(doc, annotationData);
          if (speakButton) button.after(speakButton);
        });
      });
      append(placeholder);
    },
    config.addonID,
  );
}

function createTranslateAnnotationButton(
  doc: Document,
  reader: _ZoteroTypes.ReaderInstance,
  annotationData: any,
): HTMLElement {
  return ztoolkit.UI.createElement(doc, "div", {
    classList: ["icon"],
    properties: {
      innerHTML: SVGIcon,
      title: getString("sideBarIcon-title"),
    },
    listeners: [
      {
        type: "click",
        listener: (e) => {
          const task = addTranslateAnnotationTask(
            reader._item.libraryID,
            annotationData.id,
          );
          addon.hooks.onTranslate(task, {
            noCheckZoteroItemLanguage: true,
            noDisplay: true,
          });
          e.preventDefault();
        },
      },
      {
        type: "mouseover",
        listener: (e) => {
          (e.target as HTMLElement).style.backgroundColor =
            "var(--color-sidepane)";
        },
      },
      {
        type: "mouseout",
        listener: (e) => {
          (e.target as HTMLElement).style.removeProperty("background-color");
        },
      },
    ],
    enableElementRecord: false,
    ignoreIfExists: true,
  });
}

/**
 * Clicking an annotation in the PDF (or its sidebar card) replays the original
 * annotation text. The normal Zotero click behavior is preserved (we do not
 * call preventDefault), so the annotation popup still opens.
 */
const annotatedClickHandled = new WeakSet<Event>();
const annotationBoundRoots = new WeakSet<object>();
const popupObservedDocs = new WeakSet<Document>();
let lastPopupKey = "";
let lastPopupAt = 0;
let lastAnnotationSpeakKey = "";
let lastAnnotationSpeakAt = 0;

function annotationItemFromKey(
  reader: _ZoteroTypes.ReaderInstance,
  key: string,
): Zotero.Item | false {
  const libraryID = reader?._item?.libraryID;
  try {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, key) as
      | Zotero.Item
      | false;
    if (item) return item;
  } catch {
    // fall through to numeric id
  }
  if (/^\d+$/.test(key)) {
    return Zotero.Items.get(Number(key)) || false;
  }
  return false;
}

function speakAnnotationByKey(
  reader: _ZoteroTypes.ReaderInstance,
  key: string,
  win: Window | null,
): boolean {
  const item = annotationItemFromKey(reader, key);
  if (!item) return false;
  const text = annotationSpeechText({
    text: item.annotationText,
    comment: item.annotationComment,
  });
  if (!text || !win) return false;
  if (
    key === lastAnnotationSpeakKey &&
    Date.now() - lastAnnotationSpeakAt < 600
  ) {
    return true;
  }
  lastAnnotationSpeakKey = key;
  lastAnnotationSpeakAt = Date.now();
  return speak(text, { win, lang: "en-US" });
}

function bindAnnotationRoot(
  reader: _ZoteroTypes.ReaderInstance,
  doc: Document | ShadowRoot,
): void {
  if (!doc || annotationBoundRoots.has(doc)) return;
  annotationBoundRoots.add(doc);
  try {
    Zotero.debug(
      `[ZotEasyTran] bind ${doc instanceof ShadowRoot ? "shadow" : (doc as Document).URL || "doc"}`,
    );
  } catch {
    // ignore
  }

  let lastSpokenAt = 0;
  const onPointer = (event: Event) => {
    const path = (event.composedPath?.() || []) as Array<Element>;
    const target = path.find(
      (node) =>
        node &&
        node.nodeType === 1 &&
        typeof (node as Element).hasAttribute === "function" &&
        (node as Element).hasAttribute("data-annotation-id"),
    );
    if (!target) {
      // Zotero may hit-test annotations on the PDF canvas instead of exposing
      // data-annotation-id in the composed path. After the click, if Zotero
      // opened an annotation popup, replay the selected annotation.
      try {
        const appDoc = (reader as any)?._iframeWindow?.document as
          | Document
          | undefined;
        if (appDoc && doc !== appDoc) {
          setTimeout(() => {
            try {
              if (!appDoc.querySelector(".annotation-popup")) return;
              const ids =
                (reader as any)?._internalReader?._state
                  ?.selectedAnnotationIDs || [];
              if (ids.length !== 1) return;
              if (Date.now() - lastSpokenAt < 350) return;
              lastSpokenAt = Date.now();
              Zotero.debug(`[ZotEasyTran] deferred annotation click ${ids[0]}`);
              speakAnnotationByKey(
                reader,
                ids[0],
                getSpeechWindow(appDoc.defaultView),
              );
            } catch {
              // ignore
            }
          }, 150);
        }
      } catch {
        // ignore
      }
      const popup = path.find(
        (node) =>
          node instanceof Element &&
          node.classList?.contains("annotation-popup"),
      );
      if (popup) {
        const first = path.find((node) => node instanceof Element) as
          | Element
          | undefined;
        if (first?.closest("input, textarea, [contenteditable='true']")) {
          return;
        }
        const ids =
          (reader as any)?._internalReader?._state?.selectedAnnotationIDs || [];
        if (ids.length === 1) {
          Zotero.debug(`[ZotEasyTran] annotation popup click ${ids[0]}`);
          speakAnnotationByKey(
            reader,
            ids[0],
            getSpeechWindow((doc as Document).defaultView || null),
          );
        } else {
          Zotero.debug(
            "[ZotEasyTran] annotation popup click (no selection id)",
          );
        }
      }
      return;
    }
    if (
      path.some(
        (node) =>
          node instanceof Element &&
          (node.classList?.contains("icon") ||
            node.classList?.contains("toolbar-button") ||
            node.classList?.contains("zoteasytran-speak")),
      )
    ) {
      return;
    }

    const key = target.getAttribute("data-annotation-id");
    if (!key) return;
    if (Date.now() - lastSpokenAt < 350) return;
    lastSpokenAt = Date.now();
    const win = getSpeechWindow((doc as Document).defaultView || null);
    Zotero.debug(`[ZotEasyTran] annotation click ${key}`);
    speakAnnotationByKey(reader, key, win);
  };

  doc.addEventListener("pointerdown", onPointer, true);
  doc.addEventListener("click", onPointer, true);
}

/**
 * When Zotero opens the annotation popup, replay the selected annotation.
 *
 * The PDF text/annotation layer is hit-tested by Zotero itself, so a plain DOM
 * click on a highlight is not guaranteed to expose data-annotation-id. The
 * popup is the reliable signal that an annotation was activated.
 */
function attachAnnotationPopupObserver(
  reader: _ZoteroTypes.ReaderInstance,
): void {
  let appDoc: Document | undefined;
  try {
    appDoc = (reader as any)?._iframeWindow?.document as Document | undefined;
  } catch {
    return;
  }
  if (!appDoc || popupObservedDocs.has(appDoc)) return;
  popupObservedDocs.add(appDoc);

  const handle = () => {
    try {
      const popup = appDoc?.querySelector(".annotation-popup");
      if (!popup) return;
      const ids =
        (reader as any)?._internalReader?._state?.selectedAnnotationIDs || [];
      if (ids.length !== 1) return;
      const key = String(ids[0]);
      if (key === lastPopupKey && Date.now() - lastPopupAt < 1000) return;
      lastPopupKey = key;
      lastPopupAt = Date.now();
      Zotero.debug(`[ZotEasyTran] annotation popup opened ${key}`);
      speakAnnotationByKey(
        reader,
        key,
        getSpeechWindow(appDoc?.defaultView || null),
      );
    } catch {
      // ignore
    }
  };

  try {
    new MutationObserver(handle).observe(appDoc.body, {
      childList: true,
      subtree: true,
    });
  } catch {
    // ignore
  }
  handle();
}

function collectDocuments(
  doc: Document,
  out: Document[] = [],
  depth = 0,
): Document[] {
  if (!doc || out.includes(doc) || depth > 3) return out;
  out.push(doc);
  try {
    for (const iframe of Array.from(doc.querySelectorAll("iframe"))) {
      try {
        const child = (iframe as HTMLIFrameElement).contentDocument;
        if (child) collectDocuments(child, out, depth + 1);
      } catch {
        // cross-origin or not ready
      }
    }
  } catch {
    // ignore
  }
  return out;
}

function attachAnnotationClickHandler(
  reader: _ZoteroTypes.ReaderInstance,
  doc: Document,
): void {
  const roots: Document[] = [];
  if (doc) collectDocuments(doc, roots);
  try {
    const iframeDoc = (reader as any)?._iframeWindow?.document as
      | Document
      | undefined;
    if (iframeDoc) collectDocuments(iframeDoc, roots);
  } catch {
    // ignore
  }

  for (const root of roots) {
    bindAnnotationRoot(reader, root);
    try {
      const host = root.querySelector(
        "#annotation-overlay",
      ) as HTMLElement | null;
      if (host?.shadowRoot) {
        bindAnnotationRoot(reader, host.shadowRoot);
      }
    } catch {
      // ignore
    }
  }
}

function annotationSpeechText(annotationData: any): string {
  const raw = String(annotationData?.text || "");
  const splitChar = String(getPref("splitChar") || "");
  if (!splitChar) return raw.trim();
  const escaped = splitChar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return raw
    .replace(new RegExp(`${escaped}[\\s\\S]*?${escaped}`, "g"), "")
    .trim();
}

/**
 * Replay button shown next to every annotation in the reader sidebar.
 *
 * It reads the original annotation text (translation blocks are stripped when
 * the user configured "translation in annotation body"), so it works for
 * annotations created before the plugin was installed as well.
 */
function createSpeakAnnotationButton(
  doc: Document,
  annotationData: any,
): HTMLElement | null {
  const text = annotationSpeechText(annotationData);
  if (!text) return null;
  return ztoolkit.UI.createElement(doc, "div", {
    classList: ["icon", "zoteasytran-speak"],
    properties: {
      innerHTML: "🔊",
      title: getString("sideBarSpeak-title"),
    },
    listeners: [
      {
        type: "click",
        listener: (e) => {
          const win = getSpeechWindow(doc.defaultView);
          if (!win) {
            ztoolkit.log("ZotEasyTran: no speech-capable window");
            return;
          }
          speak(text, { win, lang: "en-US" });
          e.preventDefault();
        },
      },
      {
        type: "mouseover",
        listener: (e) => {
          (e.target as HTMLElement).style.backgroundColor =
            "var(--color-sidepane)";
        },
      },
      {
        type: "mouseout",
        listener: (e) => {
          (e.target as HTMLElement).style.removeProperty("background-color");
        },
      },
    ],
    enableElementRecord: false,
    ignoreIfExists: true,
  });
}
