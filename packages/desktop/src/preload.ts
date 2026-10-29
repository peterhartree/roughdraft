import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  DROPPED_MARKDOWN_IPC_CHANNEL,
  resolveDroppedMarkdownPath,
} from "./dropped-markdown.js";
import { LOCATE_MARKDOWN_IPC_CHANNEL } from "./locate-markdown.js";
import { RECENT_DOCUMENTS_IPC_CHANNEL } from "./recent-documents-channel.js";
import {
  WINDOW_SESSION_CHANNEL,
  CLAIM_DOCUMENT_CHANNEL,
  CANCEL_CLOSE_CHANNEL,
  REPORT_DOCUMENTS_CHANNEL,
  RELEASE_DOCUMENT_CHANNEL,
  WINDOW_READY_CHANNEL,
  OPEN_DOCUMENT_CHANNEL,
  PREPARE_CLOSE_CHANNEL,
  PREPARE_CLOSE_RESULT_CHANNEL,
  LIST_OTHER_WINDOWS_CHANNEL,
  MOVE_DOCUMENT_CHANNEL,
  type DesktopOpenIntent,
  type DesktopWindowSummary,
} from "./window-channels.js";

let closePending = false;
function unlockEditor(): void {
  closePending = false;
  if (document.body) document.body.inert = false;
}
ipcRenderer.on(CANCEL_CLOSE_CHANNEL, unlockEditor);
window.addEventListener(
  "keydown",
  (event) => {
    if (!closePending) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);

const sessionKey =
  process.argv
    .find((arg) => arg.startsWith("--roughdraft-window="))
    ?.split("=")[1] ?? "default";

contextBridge.exposeInMainWorld("roughdraftDesktop", {
  session: {
    key: sessionKey,
    migrateLegacy: process.argv.includes("--roughdraft-migrate-session"),
  },
  startDocumentSession: (paths: string[]) =>
    ipcRenderer.invoke(WINDOW_SESSION_CHANNEL, paths),
  claimDocument: (path: string) =>
    ipcRenderer.invoke(CLAIM_DOCUMENT_CHANNEL, path),
  reportOpenDocuments: (paths: string[]) =>
    ipcRenderer.send(REPORT_DOCUMENTS_CHANNEL, paths),
  releaseDocument: (path: string) =>
    ipcRenderer.send(RELEASE_DOCUMENT_CHANNEL, path),
  ready: () => ipcRenderer.send(WINDOW_READY_CHANNEL),
  listOtherWindows: (): Promise<DesktopWindowSummary[]> =>
    ipcRenderer.invoke(LIST_OTHER_WINDOWS_CHANNEL),
  moveDocument: (path: string, windowId: string | null): Promise<boolean> =>
    ipcRenderer.invoke(MOVE_DOCUMENT_CHANNEL, path, windowId),
  onOpenDocument: (listener: (intent: DesktopOpenIntent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      intent: DesktopOpenIntent,
    ) => listener(intent);
    ipcRenderer.on(OPEN_DOCUMENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(OPEN_DOCUMENT_CHANNEL, handler);
  },
  onPrepareClose: (prepare: () => Promise<boolean>) => {
    const handler = async (
      _event: Electron.IpcRendererEvent,
      requestId: number,
    ) => {
      closePending = true;
      if (document.body) document.body.inert = true;
      let ready = false;
      try {
        ready = await prepare();
      } catch {
        /* Keep the window open on save failure. */
      }
      ipcRenderer.send(PREPARE_CLOSE_RESULT_CHANNEL, requestId, ready);
    };
    ipcRenderer.on(PREPARE_CLOSE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(PREPARE_CLOSE_CHANNEL, handler);
  },
  locateMarkdownFile: async (): Promise<string | null> => {
    const filePath: unknown = await ipcRenderer.invoke(
      LOCATE_MARKDOWN_IPC_CHANNEL,
    );
    return typeof filePath === "string" && filePath.trim() ? filePath : null;
  },
  setRecentDocuments: (paths: string[]): void => {
    ipcRenderer.send(RECENT_DOCUMENTS_IPC_CHANNEL, paths);
  },
});

window.addEventListener(
  "DOMContentLoaded",
  () => {
    document.addEventListener(
      "dragover",
      (event) => {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
      true,
    );

    document.addEventListener(
      "drop",
      (event) => {
        if (!event.dataTransfer?.files.length) return;

        const filePath = resolveDroppedMarkdownPath(
          event.dataTransfer.files,
          (file) => webUtils.getPathForFile(file),
        );
        if (!filePath) return;

        event.preventDefault();
        event.stopPropagation();
        ipcRenderer.send(DROPPED_MARKDOWN_IPC_CHANNEL, filePath);
      },
      true,
    );
  },
  { once: true },
);
