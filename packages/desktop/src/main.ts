import {
  app,
  BrowserWindow,
  dialog,
  type Event,
  ipcMain,
  Menu,
  type OpenDialogOptions,
  type SaveDialogOptions,
  session,
  shell,
  type WebContents,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplicationMenuTemplate } from "./application-menu.js";
import { shouldSuppressNativeDocumentShortcut } from "./document-shortcuts.js";
import { DROPPED_MARKDOWN_IPC_CHANNEL } from "./dropped-markdown.js";
import { LOCATE_MARKDOWN_IPC_CHANNEL } from "./locate-markdown.js";
import { createManagedServerLoader } from "./managed-server-loader.js";
import {
  NativeOpenPathQueue,
  postOpenDocumentIntent,
  resolveMarkdownOpenIntent,
} from "./native-open.js";
import {
  createMarkdownFile,
  NEW_MARKDOWN_FILE_NAME,
  newMarkdownFileDirectory,
} from "./new-markdown-file.js";
import { shouldAllowRendererPermission } from "./permission-policy.js";
import { parseRecentDocumentPaths } from "./recent-documents.js";
import { RECENT_DOCUMENTS_IPC_CHANNEL } from "./recent-documents-channel.js";
import {
  isAllowedExternalUrl,
  isAllowedNavigation,
  isServedFileNavigation,
  readManagedServerTarget,
  resolveManagedServerStateFile,
  verifyManagedServerTarget,
} from "./server-target.js";
import {
  appendDesktopSlog,
  nextServerLoadRetryDelay,
  startManagedServer,
} from "./startup.js";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

let mainWindow: BrowserWindow | null = null;
let validatedOrigin: string | null = null;
let loadingErrorDocument = false;
const nativeOpenPaths = new NativeOpenPathQueue();
let nativeOpenDelivery = Promise.resolve();
let recentDocumentPaths: string[] = [];

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showNativeOpenError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox("Could not open Markdown file", message);
}

async function deliverNativeOpenPath(filePath: string): Promise<void> {
  try {
    if (!validatedOrigin) {
      throw new Error("The managed Roughdraft server is unavailable.");
    }

    const intent = resolveMarkdownOpenIntent(filePath);
    await postOpenDocumentIntent(fetch, validatedOrigin, intent);
    focusMainWindow();
  } catch (error) {
    showNativeOpenError(error);
  }
}

function scheduleNativeOpenPath(filePath: string): void {
  nativeOpenDelivery = nativeOpenDelivery.then(() =>
    deliverNativeOpenPath(filePath),
  );
}

async function ensureNativeOpenDestination(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createMainWindow();
  } else if (!validatedOrigin) {
    await loadManagedServer();
  }

  if (!validatedOrigin) {
    showNativeOpenError(
      new Error("Start the managed Roughdraft server, then try again."),
    );
  }
}

async function chooseMarkdownFile(): Promise<void> {
  const options = {
    title: "Open Markdown file",
    properties: ["openFile"],
    filters: [{ name: "Markdown", extensions: ["md"] }],
  } satisfies OpenDialogOptions;
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
  const filePath = result.filePaths[0];
  if (result.canceled || !filePath) return;

  await openMarkdownPath(filePath);
}

// Roughdraft edits files in place, so a new document is created on disk
// first and then opened like any other file.
async function createNewMarkdownFile(): Promise<void> {
  const hasWindow = mainWindow !== null && !mainWindow.isDestroyed();
  const directory = newMarkdownFileDirectory(
    hasWindow && mainWindow ? mainWindow.webContents.getURL() : "",
    recentDocumentPaths,
    app.getPath("documents"),
  );
  const options = {
    title: "New Markdown file",
    buttonLabel: "Create",
    defaultPath: path.join(directory, NEW_MARKDOWN_FILE_NAME),
    filters: [{ name: "Markdown", extensions: ["md"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  } satisfies SaveDialogOptions;
  const result =
    hasWindow && mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return;

  let filePath: string;
  try {
    filePath = await createMarkdownFile(result.filePath, (target) =>
      shell.trashItem(target),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Could not create Markdown file", message);
    return;
  }

  await openMarkdownPath(filePath);
}

async function openMarkdownPath(filePath: string): Promise<void> {
  nativeOpenPaths.request(filePath);
  await ensureNativeOpenDestination();
}

function installApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createApplicationMenuTemplate(
        {
          newMarkdownFile: () => {
            void createNewMarkdownFile();
          },
          openMarkdownFile: () => {
            void chooseMarkdownFile();
          },
          openRecentDocument: (filePath) => {
            void openMarkdownPath(filePath);
          },
        },
        recentDocumentPaths,
      ),
    ),
  );
}

function errorDocument(message: string): string {
  const escaped = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const document = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Roughdraft unavailable</title>
<style>body{font:16px/1.5 system-ui;margin:0;padding:48px;background:#f7f5ef;color:#25231f}main{max-width:680px;margin:auto}h1{font-size:28px}code{background:#ebe7dc;padding:2px 5px;border-radius:4px}</style>
<main><h1>Roughdraft is not running</h1><p>${escaped}</p><p>Open a Markdown file with <code>roughdraft open /absolute/path/to/file.md</code>, then reopen this app.</p></main></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(document)}`;
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: "#f7f5ef",
    title: "Roughdraft",
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Sandboxed preloads cannot load ES modules, so the build bundles this
      // one into a single CommonJS file.
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => focusMainWindow());
  mainWindow.on("closed", () => {
    nativeOpenPaths.disconnect();
    mainWindow = null;
  });

  const preventDisallowedNavigation = (event: Event, url: string) => {
    if (loadingErrorDocument && url.startsWith("data:text/html")) return;
    if (!validatedOrigin || !isAllowedNavigation(url, validatedOrigin)) {
      event.preventDefault();
      return;
    }
    if (isServedFileNavigation(url, validatedOrigin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  };
  mainWindow.webContents.on("will-navigate", preventDisallowedNavigation);
  mainWindow.webContents.on("will-redirect", preventDisallowedNavigation);
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.setIgnoreMenuShortcuts(
      shouldSuppressNativeDocumentShortcut(
        input,
        mainWindow.webContents.getURL(),
        validatedOrigin,
      ),
    );
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  await loadManagedServer();
}

const managedServerLoader = createManagedServerLoader<BrowserWindow>({
  resolvePage: () =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
  startServer: startManagedServer,
  resolveTarget: () =>
    verifyManagedServerTarget(
      readManagedServerTarget(resolveManagedServerStateFile()),
    ),
  loadUrl: (window, url) => window.loadURL(url),
  loadErrorDocument: async (window, message) => {
    loadingErrorDocument = true;
    try {
      await window.loadURL(errorDocument(message));
    } finally {
      loadingErrorDocument = false;
    }
  },
  setOrigin: (origin) => {
    validatedOrigin = origin;
  },
  onConnected: () => nativeOpenPaths.connect(scheduleNativeOpenPath),
  onDisconnected: () => nativeOpenPaths.disconnect(),
  nextRetryDelay: nextServerLoadRetryDelay,
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  slog: appendDesktopSlog,
});

function loadManagedServer(): Promise<void> {
  return managedServerLoader.load();
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  nativeOpenPaths.request(filePath);

  if (app.isReady()) {
    void ensureNativeOpenDestination();
  }
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (validatedOrigin === null) {
      void loadManagedServer().finally(focusMainWindow);
      return;
    }
    focusMainWindow();
  });

  app.whenReady().then(async () => {
    if (process.platform === "darwin" && app.isPackaged) {
      try {
        app.setLoginItemSettings({ openAtLogin: true });
        appendDesktopSlog("desktop.login-item.configured", {
          openAtLogin: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendDesktopSlog("desktop.login-item.failed", { message });
        console.error(
          `Could not configure Roughdraft to open at login: ${message}`,
        );
      }
    }

    installApplicationMenu();

    const isMainWindowWebContents = (webContents: WebContents | null) =>
      webContents !== null &&
      mainWindow !== null &&
      !mainWindow.isDestroyed() &&
      webContents === mainWindow.webContents;

    ipcMain.on(DROPPED_MARKDOWN_IPC_CHANNEL, (event, filePath: unknown) => {
      if (
        !isMainWindowWebContents(event.sender) ||
        event.senderFrame !== event.sender.mainFrame ||
        typeof filePath !== "string" ||
        !filePath.trim()
      ) {
        return;
      }

      nativeOpenPaths.request(filePath);
    });

    ipcMain.on(RECENT_DOCUMENTS_IPC_CHANNEL, (event, value: unknown) => {
      if (
        !isMainWindowWebContents(event.sender) ||
        event.senderFrame !== event.sender.mainFrame
      ) {
        return;
      }

      const paths = parseRecentDocumentPaths(value);
      if (!paths || paths.join("\0") === recentDocumentPaths.join("\0")) {
        return;
      }

      recentDocumentPaths = paths;
      installApplicationMenu();
    });

    ipcMain.handle(LOCATE_MARKDOWN_IPC_CHANNEL, async (event) => {
      if (
        !isMainWindowWebContents(event.sender) ||
        event.senderFrame !== event.sender.mainFrame ||
        !mainWindow ||
        mainWindow.isDestroyed()
      ) {
        return null;
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Locate Markdown file",
        properties: ["openFile"],
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      const filePath = result.filePaths[0];
      return result.canceled || !filePath ? null : filePath;
    });

    session.defaultSession.setPermissionCheckHandler(
      (webContents, permission, requestingOrigin, details) =>
        isMainWindowWebContents(webContents) &&
        shouldAllowRendererPermission({
          permission,
          requestingOrigin,
          validatedOrigin,
          isMainFrame: details.isMainFrame,
        }),
    );
    session.defaultSession.setPermissionRequestHandler(
      (webContents, permission, callback, details) =>
        callback(
          isMainWindowWebContents(webContents) &&
            shouldAllowRendererPermission({
              permission,
              requestingOrigin: details.requestingUrl,
              validatedOrigin,
              isMainFrame: details.isMainFrame,
            }),
        ),
    );
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (
        !validatedOrigin ||
        !isAllowedNavigation(details.url, validatedOrigin)
      ) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [CONTENT_SECURITY_POLICY],
        },
      });
    });

    await createMainWindow();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
      return;
    }
    if (validatedOrigin === null) {
      void loadManagedServer().finally(focusMainWindow);
      return;
    }
    // The CLI activates the app when it finds no server running.
    void managedServerLoader.ensureConnected();
    focusMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
