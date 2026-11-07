import { config, homepage } from "../../package.json";
import { LANG_CODE } from "../utils/config";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import {
  getServiceSecret,
  setServiceSecret,
  validateServiceSecret,
} from "../utils/secret";
import { createServiceSettingsDialog } from "../utils";
import { services } from "./services";
import {
  getDictionaryStatus,
  getGlossaryCount,
  importGlossaryText,
  resetDictionaryConnection,
} from "./local/dictionary";
import { resetGlossaryCache } from "./local/realLexicon";
import { getTtsRate, speak } from "./local/tts";

export function registerPrefsWindow() {
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: rootURI + "chrome/content/preferences.xhtml",
    label: getString("pref-title"),
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
    helpURL: homepage,
  });
}

export function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  addon.data.prefs.window = _window;
  buildPrefsPane();
  updatePrefsPaneDefault();
  wireLocalSettings();
  void updateLocalDictStatus();
}

function buildPrefsPane() {
  const doc = addon.data.prefs.window?.document;
  if (!doc) {
    return;
  }

  // menus
  ztoolkit.UI.replaceElement(
    {
      tag: "menulist",
      id: makeId("sentenceServices"),
      attributes: {
        value: getPref("translateSource") as string,
        native: "true",
      },
      listeners: [
        {
          type: "command",
          listener: (e: Event) => {
            onPrefsEvents("setSentenceService");
          },
        },
      ],
      children: [
        {
          tag: "menupopup",
          children: services.getAllServicesWithType("sentence").map((s) => ({
            tag: "menuitem",
            attributes: {
              label: services.getServiceNameByID(s.id),
              value: s.id,
            },
          })),
        },
      ],
    },
    doc.querySelector(`#${makeId("sentenceServices-placeholder")}`)!,
  );

  ztoolkit.UI.replaceElement(
    {
      tag: "menulist",
      id: makeId("wordServices"),
      attributes: {
        value: getPref("dictSource") as string,
        native: "true",
      },
      classList: ["use-word-service"],
      listeners: [
        {
          type: "command",
          listener: (e: Event) => {
            onPrefsEvents("setWordService");
          },
        },
      ],
      children: [
        {
          tag: "menupopup",
          children: services.getAllServicesWithType("word").map((s) => ({
            tag: "menuitem",
            attributes: {
              label: services.getServiceNameByID(s.id),
              value: s.id,
            },
          })),
        },
      ],
    },
    doc.querySelector(`#${makeId("wordServices-placeholder")}`)!,
  );

  ztoolkit.UI.replaceElement(
    {
      tag: "menulist",
      id: makeId("langfrom"),
      attributes: {
        value: getPref("sourceLanguage") as string,
        native: "true",
      },
      listeners: [
        {
          type: "command",
          listener: (e: Event) => {
            onPrefsEvents("setSourceLanguage");
          },
        },
      ],
      styles: {
        maxWidth: "250px",
      },
      children: [
        {
          tag: "menupopup",
          children: LANG_CODE.map((lang) => ({
            tag: "menuitem",
            attributes: {
              label: lang.name,
              value: lang.code,
            },
          })),
        },
      ],
    },
    doc.querySelector(`#${makeId("langfrom-placeholder")}`)!,
  );

  ztoolkit.UI.replaceElement(
    {
      tag: "menulist",
      id: makeId("langto"),
      attributes: {
        value: getPref("targetLanguage") as string,
        native: "true",
      },
      listeners: [
        {
          type: "command",
          listener: (e: Event) => {
            onPrefsEvents("setTargetLanguage");
          },
        },
      ],
      styles: {
        maxWidth: "250px",
      },
      children: [
        {
          tag: "menupopup",
          children: LANG_CODE.map((lang) => ({
            tag: "menuitem",
            attributes: {
              label: lang.name,
              value: lang.code,
            },
          })),
        },
      ],
    },
    doc.querySelector(`#${makeId("langto-placeholder")}`)!,
  );

  doc
    .querySelector(`#${makeId("manageKeys")}`)
    ?.addEventListener("command", (e: Event) => {
      onPrefsEvents("manageKeys");
    });
  doc
    .querySelector(`#${makeId("renameServices")}`)
    ?.addEventListener("command", (e: Event) => {
      onPrefsEvents("renameServices");
    });

  doc
    .querySelector(`#${makeId("enableAuto")}`)
    ?.addEventListener("command", (e: Event) => {
      onPrefsEvents("setAutoTranslateSelection");
    });

  doc
    .querySelector(`#${makeId("enableComment")}`)
    ?.addEventListener("command", (e: Event) => {
      onPrefsEvents("setAutoTranslateAnnotation");
    });

  doc
    .querySelector(`#${makeId("annotationTranslationPosition")}`)
    ?.addEventListener("command", (e: Event) => {
      onPrefsEvents("setAnnotationTranslationPosition");
    });

  doc
    .querySelector(`#${makeId("enablePopup")}`)
    ?.addEventListener("command", (e: Event) => {
      onPrefsEvents("setEnablePopup");
    });

  doc
    .querySelector(`#${makeId("enableAddToNote")}`)
    ?.addEventListener("command", (e: Event) => {
      onPrefsEvents("setEnableAddToNote");
    });

  doc
    .querySelector(`#${makeId("showPlayBtn")}`)
    ?.addEventListener("command", (e: Event) => {
      onPrefsEvents("setShowPlayBtn");
    });

  doc
    .querySelector(`#${makeId("useWordService")}`)
    ?.addEventListener("command", (e: Event) => {
      onPrefsEvents("setUseWordService");
    });

  doc
    .querySelector(`#${makeId("hideUnconfiguredServices")}`)
    ?.addEventListener("command", () => {
      addon.hooks.onReaderTabPanelRefresh();
    });

  doc
    .querySelector(`#${makeId("sentenceServicesSecret")}`)
    ?.addEventListener("blur", (e: Event) => {
      onPrefsEvents("updateSentenceSecret");
    });

  doc
    .querySelector(`#${makeId("wordServicesSecret")}`)
    ?.addEventListener("blur", (e: Event) => {
      onPrefsEvents("updateWordSecret");
    });

  doc
    .querySelector(`#${makeId("fontSize")}`)
    ?.addEventListener("input", (e: Event) => {
      onPrefsEvents("updateFontSize");
    });

  doc
    .querySelector(`#${makeId("lineHeight")}`)
    ?.addEventListener("input", (e: Event) => {
      onPrefsEvents("updatelineHeight");
    });

  doc
    .querySelector(`#${makeId("reset-titleTranslation")}`)
    ?.addEventListener("command", (e: Event) => {
      ztoolkit
        .getGlobal("ZoteroPane")
        .getSelectedItems()
        .forEach((item) => {
          ztoolkit.ExtraField.setExtraField(item, "titleTranslation", "");
        });
    });

  doc
    .querySelector(`#${makeId("reset-abstractTranslation")}`)
    ?.addEventListener("command", (e: Event) => {
      ztoolkit
        .getGlobal("ZoteroPane")
        .getSelectedItems()
        .forEach((item) => {
          ztoolkit.ExtraField.setExtraField(item, "abstractTranslation", "");
        });
    });

  doc
    .querySelector(`#${makeId("enableAutoTagAnnotation")}`)
    ?.addEventListener("command", (e: Event) => {
      onPrefsEvents("setEnableAutoTagAnnotation");
    });
}

function updatePrefsPaneDefault() {
  onPrefsEvents("setAutoTranslateAnnotation", false);
  onPrefsEvents("setAnnotationTranslationPosition", false);
  onPrefsEvents("setEnablePopup", false);
  onPrefsEvents("setShowPlayBtn", false);
  onPrefsEvents("setUseWordService", false);
  onPrefsEvents("setSentenceSecret", false);
  onPrefsEvents("setWordSecret", false);
  onPrefsEvents("setEnableAutoTagAnnotation", false);
}

function onPrefsEvents(type: string, fromElement: boolean = true) {
  const doc = addon.data.prefs.window?.document;
  if (!doc) {
    return;
  }

  const setDisabled = (className: string, disabled: boolean) => {
    doc
      .querySelectorAll(`.${className}`)
      .forEach(
        (elem) => ((elem as XUL.Element & XUL.IDisabled).disabled = disabled),
      );
  };
  switch (type) {
    case "setAutoTranslateSelection":
      addon.hooks.onReaderTabPanelRefresh();
      break;
    case "setAutoTranslateAnnotation":
      {
        addon.hooks.onReaderTabPanelRefresh();
      }
      break;
    case "setAnnotationTranslationPosition":
      {
        const elemValue = fromElement
          ? (
              doc.querySelector(
                `#${makeId("annotationTranslationPosition")}`,
              ) as XUL.Element
            ).getAttribute("value")
          : (getPref("annotationTranslationPosition") as string);
        const hidden = elemValue !== "body";
        setDisabled("annotation-translation-position-in-body", hidden);
      }
      break;
    case "setEnablePopup":
      {
        const elemValue = fromElement
          ? (doc.querySelector(`#${makeId("enablePopup")}`) as XUL.Checkbox)
              .checked
          : (getPref("enablePopup") as boolean);
        const hidden = !elemValue;
        setDisabled("enable-popup", hidden);
        if (!hidden) {
          onPrefsEvents("setEnableAddToNote", fromElement);
        }
      }
      break;
    case "setEnableAddToNote":
      {
        const elemValue = fromElement
          ? (doc.querySelector(`#${makeId("enableAddToNote")}`) as XUL.Checkbox)
              .checked
          : (getPref("enableNote") as boolean);
        const hidden = !elemValue;
        setDisabled("enable-popup-addtonote", hidden);
      }
      break;
    case "setShowPlayBtn":
      {
        const elemValue = fromElement
          ? (doc.querySelector(`#${makeId("showPlayBtn")}`) as XUL.Checkbox)
              .checked
          : (getPref("showPlayBtn") as boolean);
        const hidden = !elemValue;
        setDisabled("show-play-btn", hidden);
      }
      break;
    case "setUseWordService":
      {
        const elemValue = fromElement
          ? (doc.querySelector(`#${makeId("useWordService")}`) as XUL.Checkbox)
              .checked
          : (getPref("enableDict") as boolean);
        const hidden = !elemValue;
        setDisabled("use-word-service", hidden);
        if (!hidden) {
          onPrefsEvents("setShowPlayBtn", fromElement);
        }
      }
      break;
    case "setEnableAutoTagAnnotation":
      {
        const elemValue = fromElement
          ? (
              doc.querySelector(
                `#${makeId("enableAutoTagAnnotation")}`,
              ) as XUL.Checkbox
            ).checked
          : (getPref("enableAutoTagAnnotation") as boolean);
        const hidden = !elemValue;
        setDisabled("enable-auto-tag-annotation", hidden);
      }
      break;
    case "setSentenceService":
      {
        setPref(
          "translateSource",
          (
            doc.querySelector(`#${makeId("sentenceServices")}`) as XUL.MenuList
          ).getAttribute("value")!,
        );
        onPrefsEvents("setSentenceSecret", fromElement);
        addon.hooks.onReaderTabPanelRefresh();
      }
      break;
    case "updateSentenceSecret":
      {
        const serviceId = getPref("translateSource") as string;
        const inputElem = doc.querySelector(
          `#${makeId("sentenceServicesSecret")}`,
        ) as HTMLInputElement;
        const trimmedValue = inputElem.value.trim();
        if (trimmedValue !== inputElem.value) {
          inputElem.value = trimmedValue;
        }
        if (trimmedValue !== getServiceSecret(serviceId)) {
          setServiceSecret(serviceId, trimmedValue);
        }
      }
      break;
    case "setSentenceSecret":
      {
        const serviceId = getPref("translateSource") as string;
        const secretCheckResult = validateServiceSecret(
          serviceId,
          (validateResult) => {
            if (fromElement && !validateResult.status) {
              addon.data.prefs.window?.alert(
                `You see this because the translation service ${serviceId} requires SECRET, which is NOT correctly set.\n\nDetails:\n${validateResult.info}`,
              );
            }
          },
        );
        (
          doc.querySelector(
            `#${makeId("sentenceServicesSecret")}`,
          ) as HTMLInputElement
        ).value = secretCheckResult.secret;

        // Update secret status button
        const statusButton = doc.querySelector(
          `#${makeId("sentenceServicesStatus")}`,
        ) as XUL.Button;
        const service =
          addon.data.translate.services.getServiceById(serviceId)!;
        if (service.config) {
          statusButton.hidden = false;
          statusButton.label = getString("service-dialog-config");
          statusButton.onclick = (ev) => {
            createServiceSettingsDialog(service);
          };
        } else {
          statusButton.hidden = true;
        }
      }
      break;
    case "setWordService":
      {
        setPref(
          "dictSource",
          (
            doc.querySelector(`#${makeId("wordServices")}`) as XUL.MenuList
          ).getAttribute("value")!,
        );
        onPrefsEvents("setWordSecret", fromElement);
      }
      break;
    case "updateWordSecret":
      {
        const serviceId = getPref("dictSource") as string;
        const inputElem = doc.querySelector(
          `#${makeId("wordServicesSecret")}`,
        ) as HTMLInputElement;
        const trimmedValue = inputElem.value.trim();
        if (trimmedValue !== inputElem.value) {
          inputElem.value = trimmedValue;
        }
        if (trimmedValue !== getServiceSecret(serviceId)) {
          setServiceSecret(serviceId, trimmedValue);
        }
      }
      break;
    case "setWordSecret":
      {
        const serviceId = getPref("dictSource") as string;
        const secretCheckResult = validateServiceSecret(
          serviceId,
          (validateResult) => {
            if (fromElement && !validateResult.status) {
              addon.data.prefs.window?.alert(
                `You see this because the translation service ${serviceId} requires SECRET, which is NOT correctly set.\n\nDetails:\n${validateResult.info}`,
              );
            }
          },
        );
        (
          doc.querySelector(
            `#${makeId("wordServicesSecret")}`,
          ) as HTMLInputElement
        ).value = secretCheckResult.secret;
      }
      break;
    case "setSourceLanguage":
      {
        setPref(
          "sourceLanguage",
          (
            doc.querySelector(`#${makeId("langfrom")}`) as XUL.MenuList
          ).getAttribute("value")!,
        );
        addon.hooks.onReaderTabPanelRefresh();
      }
      break;
    case "setTargetLanguage":
      {
        setPref(
          "targetLanguage",
          (
            doc.querySelector(`#${makeId("langto")}`) as XUL.MenuList
          ).getAttribute("value")!,
        );
        addon.hooks.onReaderTabPanelRefresh();
      }
      break;
    case "updateFontSize":
      addon.api.getTemporaryRefreshHandler()();
      break;
    case "updatelineHeight":
      addon.api.getTemporaryRefreshHandler()();
      break;
    case "manageKeys":
      {
        import("../modules/settings/manageKeys").then(
          ({ manageKeysDialog }) => {
            manageKeysDialog();
          },
        );
      }
      break;
    case "renameServices":
      {
        import("../modules/settings/renameServices").then(
          ({ renameServicesDialog }) => {
            renameServicesDialog();
          },
        );
      }
      break;
    default:
      return;
  }
}

async function updateLocalDictStatus() {
  const doc = addon.data.prefs.window?.document;
  const elem = doc?.querySelector(
    `#${makeId("dictStatus")}`,
  ) as HTMLElement | null;
  if (!elem) {
    return;
  }
  elem.textContent = "正在检查本地词典…";
  try {
    const status = await getDictionaryStatus();
    if (!status.exists) {
      elem.textContent = `未找到词典：${status.path}\n请在设置中选择 dictionary.sqlite，或把它放到该路径。`;
      return;
    }
    if (!status.open) {
      elem.textContent = `词典存在但无法打开：${status.path}\n${status.error || ""}`;
      return;
    }
    let glossaryCount = 0;
    try {
      glossaryCount = await getGlossaryCount();
    } catch {
      glossaryCount = 0;
    }
    elem.textContent =
      `词典已加载：${status.words ?? 0} 词条 / ${status.phrases ?? 0} 词组` +
      (status.builtAt ? `\n构建时间：${status.builtAt}` : "") +
      `\n术语表：${glossaryCount} 条` +
      `\n路径：${status.path}`;
  } catch (error) {
    elem.textContent = `检查词典失败：${String(error)}`;
  }
}

function wireLocalSettings() {
  const doc = addon.data.prefs.window?.document;
  const win = addon.data.prefs.window;
  if (!doc || !win) {
    return;
  }

  doc
    .querySelector(`#${makeId("chooseDict")}`)
    ?.addEventListener("command", async () => {
      try {
        const { FilePicker } = ChromeUtils.importESModule(
          "chrome://zotero/content/modules/filePicker.mjs",
        ) as any;
        const fp = new FilePicker();
        fp.init(win, "选择 dictionary.sqlite", fp.modeOpen);
        fp.appendFilter("SQLite", "*.sqlite; *.db");
        const result = await fp.show();
        if (result === fp.returnOK) {
          setPref("local.dictPath", fp.file);
          await resetDictionaryConnection();
          await updateLocalDictStatus();
        }
      } catch (error) {
        win.alert(`选择词典失败：${String(error)}`);
      }
    });

  doc
    .querySelector(`#${makeId("refreshDict")}`)
    ?.addEventListener("command", async () => {
      await resetDictionaryConnection();
      await updateLocalDictStatus();
    });

  doc
    .querySelector(`#${makeId("testTts")}`)
    ?.addEventListener("command", () => {
      const started =
        speak(
          "Zot Easy Tran. Local dictionary and offline speech synthesis are working.",
          { win, rate: getTtsRate() },
        ) ||
        speak(
          "Zot Easy Tran. Local dictionary and offline speech synthesis are working.",
          { win: Zotero.getMainWindow(), rate: getTtsRate() },
        );
      if (!started) {
        win.alert("未检测到可用的系统语音（speechSynthesis）。");
      }
    });

  doc
    .querySelector(`#${makeId("localDictPath")}`)
    ?.addEventListener("change", async () => {
      await resetDictionaryConnection();
      await updateLocalDictStatus();
    });

  doc
    .querySelector(`#${makeId("importGlossary")}`)
    ?.addEventListener("command", async () => {
      try {
        const { FilePicker } = ChromeUtils.importESModule(
          "chrome://zotero/content/modules/filePicker.mjs",
        ) as any;
        const fp = new FilePicker();
        fp.init(win, "选择术语表 CSV", fp.modeOpen);
        fp.appendFilter("CSV/TSV", "*.csv; *.tsv; *.txt");
        const result = await fp.show();
        if (result !== fp.returnOK) return;
        const text = await IOUtils.readUTF8(fp.file);
        const imported = await importGlossaryText(text);
        setPref("local.glossaryPath", fp.file);
        resetGlossaryCache();
        win.alert(
          `已导入 ${imported.count} 条术语` +
            (imported.skipped ? `，跳过 ${imported.skipped} 行` : "") +
            "。",
        );
        await updateLocalDictStatus();
      } catch (error) {
        win.alert(`导入术语表失败：${String(error)}`);
      }
    });
}

function makeId(type: string) {
  return `${config.addonRef}-${type}`;
}
