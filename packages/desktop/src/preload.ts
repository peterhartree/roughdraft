import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  DROPPED_MARKDOWN_IPC_CHANNEL,
  resolveDroppedMarkdownPath,
} from "./dropped-markdown.js";
import { LOCATE_MARKDOWN_IPC_CHANNEL } from "./locate-markdown.js";

contextBridge.exposeInMainWorld("roughdraftDesktop", {
  locateMarkdownFile: async (): Promise<string | null> => {
    const filePath: unknown = await ipcRenderer.invoke(
      LOCATE_MARKDOWN_IPC_CHANNEL,
    );
    return typeof filePath === "string" && filePath.trim() ? filePath : null;
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
