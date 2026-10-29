import {
  app,
  BrowserWindow,
  dialog,
  type Event,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplicationMenuTemplate } from "./application-menu.js";
import { shouldSuppressNativeDocumentShortcut } from "./document-shortcuts.js";
import { DocumentOwners } from "./document-owners.js";
import { DROPPED_MARKDOWN_IPC_CHANNEL } from "./dropped-markdown.js";
import { LOCATE_MARKDOWN_IPC_CHANNEL } from "./locate-markdown.js";
import {
  createManagedServerLoader,
  type ManagedServerLoader,
} from "./managed-server-loader.js";
import {
  postOpenDocumentIntent,
  resolveMarkdownOpenIntent,
} from "./native-open.js";
import {
  createMarkdownFile,
  NEW_MARKDOWN_FILE_NAME,
  newMarkdownFileDirectory,
} from "./new-markdown-file.js";
import { createOpenIntentStream } from "./open-intent-stream.js";
import { shouldAllowRendererPermission } from "./permission-policy.js";
import { parseRecentDocumentPaths } from "./recent-documents.js";
import { RECENT_DOCUMENTS_IPC_CHANNEL } from "./recent-documents-channel.js";
import {
  type ManagedServerTarget,
  isAllowedExternalUrl,
  isAllowedNavigation,
  isLiveHtmlFrameUrl,
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
  type DesktopOpenIntent,
  LIST_OTHER_WINDOWS_CHANNEL,
  MOVE_DOCUMENT_CHANNEL,
  type DesktopWindowSummary,
} from "./window-channels.js";
import {
  MAX_WINDOWS,
  readWindowSession,
  writeWindowSession,
  type SavedWindow,
  type WindowSession,
} from "./window-session.js";

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

interface DesktopWindow {
  id: string;
  window: BrowserWindow;
  loader: ManagedServerLoader;
  origin: string | null;
  errorDocument: boolean;
  loadingErrorDocument: boolean;
  loadingOrigin: string | null;
  crashed: boolean;
  crashRestarts: number;
  ready: boolean;
  readyBeforeNavigation: boolean;
  allowClose: boolean;
  closing: boolean;
  pending: DesktopOpenIntent | null;
}
const windows = new Map<string, DesktopWindow>();
const owners = new DocumentOwners();
let focusedId: string | undefined;
let validatedOrigin: string | null = null;
let routingAvailable = false;
let serverStart: Promise<void> | null = null;
let recentDocumentPaths: string[] = [];
let restoring = true;
let pendingOpen: { intent: DesktopOpenIntent; sourceId?: string } | null = null;
let lastWorkspace: WindowSession | null = null;
let sessionFile = "";
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let restoreTimer: ReturnType<typeof setTimeout> | undefined;
let quitting = false;
let preparingQuit = false;
let nextCloseRequest = 0;
const closeRequests = new Map<
  number,
  { id: string; finish: (ready: boolean) => void }
>();

const openStream = createOpenIntentStream({
  onIntent: (intent) => {
    void routeOpen(intent).catch(showOpenError);
  },
  slog: appendDesktopSlog,
});

function activeWindow(): DesktopWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow();
  const available = [...windows.values()].filter(
    (entry) =>
      !entry.window.isDestroyed() &&
      !entry.closing &&
      !entry.allowClose &&
      !entry.crashed,
  );
  return (
    available.find((entry) => entry.window === focused) ??
    available.find((entry) => entry.id === focusedId) ??
    available.at(-1)
  );
}

// Automated tests set this so their windows never take over the screen or
// the keyboard of the person working at the machine. On macOS
// `showInactive()` still orders a window in front of every other app's
// windows (and pulls an off-screen one back on screen), while a window that is
// never shown takes no input. So test windows are shown inactive but fully
// transparent, without a shadow, and let clicks pass through to whatever is
// underneath. Playwright drives them through the renderer, so none of this
// changes what the tests see.
const backgroundOnly = process.env.ROUGHDRAFT_DESKTOP_BACKGROUND === "1";

function showUnseen(window: BrowserWindow): void {
  window.setOpacity(0);
  window.setHasShadow(false);
  window.setIgnoreMouseEvents(true);
  window.showInactive();
}

function focusWindow(entry: DesktopWindow): void {
  if (entry.window.isDestroyed()) return;
  if (entry.window.isMinimized()) entry.window.restore();
  focusedId = entry.id;
  if (backgroundOnly) {
    if (!entry.window.isVisible()) showUnseen(entry.window);
    return;
  }
  entry.window.show();
  app.focus({ steal: true });
  entry.window.focus();
}

function snapshot(): WindowSession | null {
  const saved = [...windows.values()]
    .filter((entry) => !entry.window.isDestroyed())
    .map((entry) => ({
      id: entry.id,
      bounds: entry.window.getNormalBounds(),
      maximized: entry.window.isMaximized(),
    }));
  if (!saved.length) return lastWorkspace;
  return {
    windows: saved,
    focusedId: saved.some((entry) => entry.id === focusedId)
      ? focusedId
      : saved.at(-1)?.id,
  };
}

function persistSession(): void {
  if (!sessionFile || quitting) return;
  const state = snapshot();
  if (!state) return;
  lastWorkspace = state;
  try {
    writeWindowSession(sessionFile, state);
  } catch (error) {
    appendDesktopSlog("desktop.session.write-failed", {
      message: String(error),
    });
  }
}

function schedulePersist(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistSession, 200);
}

function trustedWindow(
  contents: WebContents | null,
): DesktopWindow | undefined {
  return [...windows.values()].find(
    (entry) =>
      !entry.window.isDestroyed() && entry.window.webContents === contents,
  );
}

function senderWindow(
  event: IpcMainEvent | IpcMainInvokeEvent,
): DesktopWindow | undefined {
  const entry = trustedWindow(event.sender);
  if (
    !entry ||
    event.senderFrame !== event.sender.mainFrame ||
    !entry.origin ||
    !isAllowedNavigation(event.senderFrame.url, entry.origin)
  )
    return undefined;
  return entry;
}

function windowLabel(entry: DesktopWindow): string {
  const title = entry.window.getTitle();
  return title.toLowerCase().endsWith(".md")
    ? path.basename(title)
    : "Window without a document";
}

function validPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length < 16_384 &&
    path.isAbsolute(value) &&
    !value.includes("\0") &&
    path.extname(value).toLowerCase() === ".md"
  );
}

function validPaths(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every(validPath);
}

function deliver(entry: DesktopWindow, intent: DesktopOpenIntent): void {
  if (entry.window.isDestroyed()) return;
  if (!entry.ready || entry.closing || entry.allowClose) {
    if (entry.pending && entry.pending.path !== intent.path)
      owners.releasePending(entry.id, entry.pending.path);
    entry.pending = intent;
    return;
  }
  entry.pending = null;
  entry.window.webContents.send(OPEN_DOCUMENT_CHANNEL, {
    ...intent,
    activate: intent.activate === true || !entry.window.isFocused(),
  });
  focusWindow(entry);
  appendDesktopSlog("desktop.open.delivered", {
    windowId: entry.id,
    path: intent.path,
  });
}

function routePending(entry: DesktopWindow): void {
  const intent = entry.pending;
  entry.pending = null;
  // Recovery may have released this reservation while another window claimed
  // the file. Resolve ownership again before delivering the queued intent.
  if (intent) void routeOpen(intent, entry.id).catch(showOpenError);
}

function finishRestore(): void {
  restoring = false;
  clearTimeout(restoreTimer);
  if (pendingOpen) {
    const pending = pendingOpen;
    pendingOpen = null;
    void routeOpen(pending.intent, pending.sourceId);
  }
}

async function routeOpen(
  intent: DesktopOpenIntent,
  sourceId?: string,
): Promise<void> {
  if (!validPath(intent.path) || quitting) return;
  if (restoring || preparingQuit || !app.isReady()) {
    pendingOpen = { intent, sourceId };
    return;
  }
  let entry = sourceId ? windows.get(sourceId) : activeWindow();
  let owner = owners.find(intent.path);
  if (owner) {
    const destination = windows.get(owner.windowId);
    if (
      !destination ||
      destination.window.isDestroyed() ||
      destination.crashed
    ) {
      owners.releaseWindow(owner.windowId);
      owner = null;
    }
  }
  if (owner && windows.has(owner.windowId)) {
    entry = windows.get(owner.windowId);
    intent = { ...intent, path: owner.path, activate: true };
  }
  entry ??= await createWindow(lastWorkspace?.windows[0]);
  if (!routingAvailable && validatedOrigin && !entry.ready) {
    // An older server/renderer remains usable as one window until updated.
    await postOpenDocumentIntent(fetch, validatedOrigin, {
      ...intent,
      modifiedAt: intent.modifiedAt ?? 0,
    }).catch(showOpenError);
    focusWindow(entry);
    return;
  }
  const claim = owners.claim(entry.id, intent.path);
  if (claim.status === "owned") {
    const destination = windows.get(claim.windowId);
    if (destination)
      deliver(destination, { ...intent, path: claim.path, activate: true });
  } else {
    deliver(entry, { ...intent, path: claim.path });
  }
}

function showOpenError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // A native alert would appear over the work of the person at the machine.
  if (backgroundOnly) {
    console.error(`Could not open Markdown file: ${message}`);
    return;
  }
  dialog.showErrorBox("Could not open Markdown file", message);
}

async function openMarkdownPath(
  filePath: string,
  sourceId?: string,
): Promise<void> {
  try {
    await routeOpen(
      { ...resolveMarkdownOpenIntent(filePath), activate: true },
      sourceId,
    );
  } catch (error) {
    showOpenError(error);
  }
}

async function chooseMarkdownFile(): Promise<void> {
  if (preparingQuit) return;
  const entry = activeWindow() ?? (await createWindow());
  const result = await dialog.showOpenDialog(entry.window, {
    title: "Open Markdown file",
    properties: ["openFile"],
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!result.canceled && result.filePaths[0])
    await openMarkdownPath(result.filePaths[0], entry.id);
}

async function createNewMarkdownFile(): Promise<void> {
  if (preparingQuit) return;
  const entry = activeWindow() ?? (await createWindow());
  const directory = newMarkdownFileDirectory(
    entry.window.webContents.getURL(),
    recentDocumentPaths,
    app.getPath("documents"),
  );
  const result = await dialog.showSaveDialog(entry.window, {
    title: "New Markdown file",
    buttonLabel: "Create",
    defaultPath: path.join(directory, NEW_MARKDOWN_FILE_NAME),
    filters: [{ name: "Markdown", extensions: ["md"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (result.canceled || !result.filePath) return;
  try {
    const filePath = await createMarkdownFile(result.filePath, (target) =>
      shell.trashItem(target),
    );
    await openMarkdownPath(filePath, entry.id);
  } catch (error) {
    showOpenError(error);
  }
}

function installApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createApplicationMenuTemplate(
        {
          newWindow: () => {
            if (windows.size >= MAX_WINDOWS) {
              dialog.showErrorBox(
                "Too many windows",
                `Close a window before opening another. Roughdraft supports up to ${MAX_WINDOWS} windows.`,
              );
              return;
            }
            if (!routingAvailable && windows.size) {
              dialog.showErrorBox(
                "Update Roughdraft's server",
                "Restart the managed Roughdraft server with the current version before opening multiple windows.",
              );
              return;
            }
            if (!preparingQuit) void createWindow();
          },
          newMarkdownFile: () => {
            void createNewMarkdownFile();
          },
          openMarkdownFile: () => {
            void chooseMarkdownFile();
          },
          openRecentDocument: (filePath) => {
            void openMarkdownPath(filePath, activeWindow()?.id);
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
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Roughdraft unavailable</title><style>body{font:16px/1.5 system-ui;padding:48px;background:#f7f5ef;color:#25231f}main{max-width:680px;margin:auto}</style><main><h1>Roughdraft is not running</h1><p>${escaped}</p><p>Open a Markdown file with the Roughdraft CLI, then reopen this app.</p></main></html>`)}`;
}

async function startServer(): Promise<void> {
  serverStart ??= startManagedServer().catch((error) => {
    serverStart = null;
    throw error;
  });
  return serverStart;
}

async function connectStream(origin: string): Promise<void> {
  const response = await fetch(new URL("/api/status", origin), {
    signal: AbortSignal.timeout(1500),
  });
  const status = (await response.json()) as { desktopWindowRouting?: boolean };
  routingAvailable = status.desktopWindowRouting === true;
  if (routingAvailable) openStream.connect(origin);
  else openStream.disconnect();
}

function prepareClose(entry: DesktopWindow): Promise<boolean> {
  if (entry.window.isDestroyed()) return Promise.resolve(true);
  if (
    entry.crashed ||
    entry.window.webContents.getURL().startsWith("data:text/html")
  )
    return Promise.resolve(true);
  if (!entry.ready) return Promise.resolve(false);
  return new Promise((resolve) => {
    const requestId = ++nextCloseRequest;
    const timer = setTimeout(() => finish(false), 8_000);
    function finish(ready: boolean): void {
      clearTimeout(timer);
      closeRequests.delete(requestId);
      resolve(ready);
    }
    closeRequests.set(requestId, { id: entry.id, finish });
    entry.window.webContents.send(PREPARE_CLOSE_CHANNEL, requestId);
  });
}

// Captured before any test replaces it, so test mode can tell the native
// dialog from a test's stand-in.
const nativeShowMessageBox = dialog.showMessageBox;

function explainBlockedClose(entry: DesktopWindow): void {
  focusWindow(entry);
  // A native alert would appear over the work of the person at the machine.
  if (backgroundOnly && dialog.showMessageBox === nativeShowMessageBox) {
    console.error("Roughdraft could not safely close this window.");
    return;
  }
  void dialog.showMessageBox(entry.window, {
    type: "warning",
    title: "Window remains open",
    message: "Roughdraft could not safely close this window.",
    detail:
      "Wait for the document to finish loading or saving, and resolve any file conflict before closing.",
    buttons: ["Keep editing"],
  });
}

async function requestQuit(): Promise<void> {
  if (preparingQuit) return;
  preparingQuit = true;
  const entries = [...windows.values()];
  const ready = await Promise.all(entries.map(prepareClose));
  const blocked = entries.find(
    (entry, index) => !ready[index] && !entry.window.isDestroyed(),
  );
  if (blocked || pendingOpen) {
    for (const entry of entries) {
      if (!entry.window.isDestroyed())
        entry.window.webContents.send(CANCEL_CLOSE_CHANNEL);
    }
    preparingQuit = false;
    if (blocked) {
      explainBlockedClose(blocked);
      appendDesktopSlog("desktop.quit.blocked", { windowId: blocked.id });
    }
    if (pendingOpen) finishRestore();
    return;
  }
  persistSession();
  session.defaultSession.flushStorageData();
  quitting = true;
  for (const entry of entries) entry.allowClose = true;
  appendDesktopSlog("desktop.quit.ready", { windows: entries.length });
  app.quit();
}

async function createWindow(
  saved?: SavedWindow,
  migrateLegacy = false,
): Promise<DesktopWindow> {
  const id = saved?.id ?? randomUUID();
  const existing = windows.get(id);
  if (existing) return existing;
  const bounds = saved?.bounds;
  const visibleBounds =
    bounds &&
    screen
      .getAllDisplays()
      .some(
        ({ workArea }) =>
          bounds.x + bounds.width > workArea.x + 80 &&
          bounds.x < workArea.x + workArea.width - 80 &&
          bounds.y >= workArea.y &&
          bounds.y < workArea.y + workArea.height - 80,
      )
      ? bounds
      : undefined;
  const window = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 720,
    minHeight: 520,
    ...visibleBounds,
    show: false,
    backgroundColor: "#f7f5ef",
    title: "Roughdraft",
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      sandbox: true,
      webSecurity: true,
      additionalArguments: [
        `--roughdraft-window=${id}`,
        ...(migrateLegacy ? ["--roughdraft-migrate-session"] : []),
      ],
    },
  });
  const entry: DesktopWindow = {
    id,
    window,
    loader: null as unknown as ManagedServerLoader,
    origin: null,
    errorDocument: false,
    loadingErrorDocument: false,
    loadingOrigin: null,
    crashed: false,
    crashRestarts: 0,
    ready: false,
    readyBeforeNavigation: false,
    allowClose: false,
    closing: false,
    pending: null,
  };
  windows.set(id, entry);
  focusedId ??= id;
  appendDesktopSlog("desktop.window.created", {
    windowId: id,
    restored: !!saved,
  });
  window.once("ready-to-show", () => {
    if (saved?.maximized) window.maximize();
    if (!restoring) focusWindow(entry);
    else if (backgroundOnly) showUnseen(window);
    else window.showInactive();
  });
  window.on("focus", () => {
    focusedId = id;
    schedulePersist();
  });
  window.on("move", schedulePersist);
  window.on("resize", schedulePersist);
  window.on("close", (event) => {
    if (entry.allowClose || quitting) return;
    event.preventDefault();
    if (entry.closing || preparingQuit) return;
    entry.closing = true;
    void prepareClose(entry).then((ready) => {
      entry.closing = false;
      if (window.isDestroyed()) return;
      if (!ready) {
        window.webContents.send(CANCEL_CLOSE_CHANNEL);
        explainBlockedClose(entry);
        routePending(entry);
        return;
      }
      // Capture the final window before destroying it, for Dock reopening.
      if (windows.size === 1) lastWorkspace = snapshot();
      entry.allowClose = true;
      window.close();
    });
  });
  window.on("closed", () => {
    windows.delete(id);
    owners.releaseWindow(id);
    for (const request of closeRequests.values())
      if (request.id === id) request.finish(true);
    if (focusedId === id) focusedId = [...windows.keys()].at(-1);
    if (!quitting) persistSession();
    if (entry.pending && !quitting)
      void routeOpen(entry.pending).catch(showOpenError);
    if (
      restoring &&
      [...windows.values()].every((candidate) => candidate.ready)
    )
      finishRestore();
    appendDesktopSlog("desktop.window.closed", { windowId: id, quitting });
  });
  window.webContents.on(
    "did-start-navigation",
    (_event, url, inPlace, mainFrame) => {
      if (!mainFrame || inPlace) return;
      const origin = entry.loadingOrigin ?? entry.origin;
      const errorPage =
        entry.loadingErrorDocument && url.startsWith("data:text/html");
      // Navigation policy cancels file handoffs and untrusted destinations;
      // the current renderer remains loaded and will not send ready again.
      if (
        !errorPage &&
        (!origin ||
          !isAllowedNavigation(url, origin) ||
          isServedFileNavigation(url, origin))
      )
        return;
      entry.readyBeforeNavigation = entry.ready;
      entry.ready = false;
    },
  );
  window.webContents.on("render-process-gone", () => {
    entry.ready = false;
    entry.readyBeforeNavigation = false;
    entry.crashed = true;
    owners.releaseWindow(id);
    appendDesktopSlog("desktop.window.renderer-crashed", { windowId: id });
    if (entry.crashRestarts++ === 0) void entry.loader.load();
  });
  window.webContents.on("did-finish-load", () => {
    entry.crashed = false;
  });
  window.webContents.on("will-prevent-unload", (event) => {
    if (entry.allowClose) {
      event.preventDefault();
      return;
    }
    entry.ready ||= entry.readyBeforeNavigation;
    entry.readyBeforeNavigation = false;
    if (entry.ready) routePending(entry);
    explainBlockedClose(entry);
  });
  const preventDisallowedNavigation = (event: Event, url: string) => {
    if (entry.loadingErrorDocument && url.startsWith("data:text/html")) return;
    if (
      (!entry.origin || !isAllowedNavigation(url, entry.origin)) &&
      (!entry.loadingOrigin || !isAllowedNavigation(url, entry.loadingOrigin))
    ) {
      event.preventDefault();
      return;
    }
    if (entry.origin && isServedFileNavigation(url, entry.origin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  };
  window.webContents.on("will-navigate", preventDisallowedNavigation);
  window.webContents.on("will-redirect", preventDisallowedNavigation);
  window.webContents.on("before-input-event", (_event, input) => {
    window.webContents.setIgnoreMenuShortcuts(
      shouldSuppressNativeDocumentShortcut(
        input,
        window.webContents.getURL(),
        entry.origin,
      ),
    );
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  entry.loader = createManagedServerLoader<BrowserWindow>({
    resolvePage: () => (window.isDestroyed() ? null : window),
    startServer,
    resolveTarget: async () => {
      try {
        return await verifyManagedServerTarget(
          readManagedServerTarget(resolveManagedServerStateFile()),
        );
      } catch (error) {
        serverStart = null;
        throw error;
      }
    },
    loadUrl: async (page, url) => {
      if (page.isDestroyed()) return;
      await page.loadURL(url);
      entry.origin = url;
      entry.loadingOrigin = null;
      entry.errorDocument = false;
      await connectStream(url);
    },
    loadErrorDocument: async (page, message) => {
      if (page.isDestroyed()) return;
      entry.loadingErrorDocument = true;
      try {
        await page.loadURL(errorDocument(message));
        entry.errorDocument = true;
      } catch (error) {
        // A dirty editor may refuse navigation; it must retain its save guards.
        appendDesktopSlog("desktop.error-page.blocked", {
          windowId: id,
          message: String(error),
        });
      } finally {
        entry.loadingErrorDocument = false;
      }
    },
    setOrigin: (origin) => {
      entry.loadingOrigin = origin;
      if (origin) {
        entry.origin ??= origin;
        validatedOrigin = origin;
      }
    },
    onConnected: () => {},
    onDisconnected: () => {
      entry.loadingOrigin = null;
    },
    nextRetryDelay: nextServerLoadRetryDelay,
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
    slog: appendDesktopSlog,
  });
  await entry.loader.load();
  if (!restoring) persistSession();
  return entry;
}

function installIpc(): void {
  ipcMain.handle(WINDOW_SESSION_CHANNEL, (event, paths: unknown) => {
    const entry = senderWindow(event);
    if (!entry || !validPaths(paths)) return [];
    const accepted: string[] = [];
    for (const filePath of paths) {
      const claim = owners.claim(entry.id, filePath);
      if (claim.status === "claimed") accepted.push(claim.path);
    }
    appendDesktopSlog("desktop.window.session-started", {
      windowId: entry.id,
      requested: paths.length,
      accepted: accepted.length,
    });
    // Initial explicit URLs are not in the sidebar until loading completes.
    // Keep these claims pending through the renderer's initial empty snapshot.
    return accepted;
  });
  ipcMain.handle(CLAIM_DOCUMENT_CHANNEL, (event, filePath: unknown) => {
    const entry = senderWindow(event);
    if (!entry || !validPath(filePath))
      throw new Error("Invalid document request");
    const previousOwner = owners.find(filePath);
    if (previousOwner) {
      const previousWindow = windows.get(previousOwner.windowId);
      if (
        !previousWindow ||
        previousWindow.window.isDestroyed() ||
        previousWindow.crashed
      )
        owners.releaseWindow(previousOwner.windowId);
    }
    const claim = owners.claim(entry.id, filePath);
    if (claim.status === "claimed") return claim;
    const destination = windows.get(claim.windowId);
    if (destination)
      deliver(destination, {
        path: claim.path,
        modifiedAt: null,
        activate: true,
      });
    return { status: "focused-existing" };
  });
  ipcMain.on(REPORT_DOCUMENTS_CHANNEL, (event, paths: unknown) => {
    const entry = senderWindow(event);
    if (entry && validPaths(paths)) owners.report(entry.id, paths);
  });
  ipcMain.on(RELEASE_DOCUMENT_CHANNEL, (event, filePath: unknown) => {
    const entry = senderWindow(event);
    if (entry && validPath(filePath)) owners.release(entry.id, filePath);
  });
  ipcMain.handle(LIST_OTHER_WINDOWS_CHANNEL, (event) => {
    const entry = senderWindow(event);
    if (!entry) return [];
    return [...windows.values()]
      .filter(
        (candidate) =>
          candidate !== entry &&
          !candidate.window.isDestroyed() &&
          !candidate.closing &&
          !candidate.allowClose &&
          !candidate.crashed,
      )
      .map(
        (candidate): DesktopWindowSummary => ({
          id: candidate.id,
          label: windowLabel(candidate),
        }),
      );
  });
  // The sender has already closed the document; it opens in the target
  // window, or in a new one when no target is given.
  ipcMain.handle(
    MOVE_DOCUMENT_CHANNEL,
    async (event, filePath: unknown, windowId: unknown) => {
      const entry = senderWindow(event);
      if (!entry || !validPath(filePath) || quitting || preparingQuit)
        return false;
      if (!routingAvailable) return false;
      let destination: DesktopWindow | undefined;
      if (windowId === null) {
        if (windows.size >= MAX_WINDOWS) return false;
      } else {
        destination =
          typeof windowId === "string" ? windows.get(windowId) : undefined;
        if (
          !destination ||
          destination === entry ||
          destination.window.isDestroyed() ||
          destination.closing ||
          destination.crashed
        )
          return false;
      }
      owners.release(entry.id, filePath);
      destination ??= await createWindow();
      await routeOpen(
        { path: filePath, modifiedAt: null, activate: true },
        destination.id,
      );
      appendDesktopSlog("desktop.document.moved", {
        fromWindowId: entry.id,
        toWindowId: destination.id,
        path: filePath,
      });
      return true;
    },
  );
  ipcMain.on(WINDOW_READY_CHANNEL, (event) => {
    const entry = senderWindow(event);
    if (!entry) return;
    entry.ready = true;
    entry.readyBeforeNavigation = false;
    routePending(entry);
    if (
      restoring &&
      [...windows.values()].every((candidate) => candidate.ready)
    ) {
      const focus = focusedId ? windows.get(focusedId) : undefined;
      if (focus) focusWindow(focus);
      finishRestore();
    }
    appendDesktopSlog("desktop.window.ready", { windowId: entry.id });
  });
  ipcMain.on(
    PREPARE_CLOSE_RESULT_CHANNEL,
    (event, requestId: unknown, ready: unknown) => {
      const entry = senderWindow(event);
      if (!entry || typeof requestId !== "number") return;
      const request = closeRequests.get(requestId);
      if (request?.id === entry.id) request.finish(ready === true);
    },
  );
  ipcMain.on(DROPPED_MARKDOWN_IPC_CHANNEL, (event, filePath: unknown) => {
    const entry = senderWindow(event);
    if (entry && validPath(filePath)) void openMarkdownPath(filePath, entry.id);
  });
  ipcMain.on(RECENT_DOCUMENTS_IPC_CHANNEL, (event, value: unknown) => {
    if (!senderWindow(event)) return;
    const paths = parseRecentDocumentPaths(value);
    if (!paths || paths.join("\0") === recentDocumentPaths.join("\0")) return;
    recentDocumentPaths = paths;
    installApplicationMenu();
  });
  ipcMain.handle(LOCATE_MARKDOWN_IPC_CHANNEL, async (event) => {
    const entry = senderWindow(event);
    if (!entry) return null;
    const result = await dialog.showOpenDialog(entry.window, {
      title: "Locate Markdown file",
      properties: ["openFile"],
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  void openMarkdownPath(filePath);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void activateApp();
  });
  app.whenReady().then(async () => {
    if (backgroundOnly && process.platform === "darwin") {
      app.setActivationPolicy("accessory");
    }
    sessionFile = path.join(app.getPath("userData"), "window-session.json");
    lastWorkspace = readWindowSession(sessionFile);
    focusedId = lastWorkspace?.focusedId;
    if (process.platform === "darwin" && app.isPackaged) {
      try {
        app.setLoginItemSettings({ openAtLogin: true });
      } catch (error) {
        appendDesktopSlog("desktop.login-item.failed", {
          message: String(error),
        });
      }
    }
    installApplicationMenu();
    installIpc();
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission, requestingOrigin, details) => {
        const entry = trustedWindow(contents);
        return (
          !!entry &&
          shouldAllowRendererPermission({
            permission,
            requestingOrigin,
            validatedOrigin: entry.origin,
            isMainFrame: details.isMainFrame,
          })
        );
      },
    );
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        const entry = trustedWindow(contents);
        callback(
          !!entry &&
            shouldAllowRendererPermission({
              permission,
              requestingOrigin: details.requestingUrl,
              validatedOrigin: entry.origin,
              isMainFrame: details.isMainFrame,
            }),
        );
      },
    );
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (
        !validatedOrigin ||
        !isAllowedNavigation(details.url, validatedOrigin) ||
        isLiveHtmlFrameUrl(details.url, validatedOrigin)
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
    // Register every restored window synchronously before their first load settles.
    const saved = lastWorkspace?.windows;
    restoreTimer = setTimeout(finishRestore, 10_000);
    await Promise.all(
      saved?.length
        ? saved.map((entry) => createWindow(entry))
        : [createWindow(undefined, true)],
    );
    persistSession();
  });
  app.on("activate", () => {
    void activateApp();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    void requestQuit();
  });
  app.on("will-quit", () => {
    clearTimeout(saveTimer);
    clearTimeout(restoreTimer);
    openStream.disconnect();
    session.defaultSession.flushStorageData();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

async function activateApp(): Promise<void> {
  if (!app.isReady() || restoring || preparingQuit) return;
  const entry =
    activeWindow() ?? (await createWindow(lastWorkspace?.windows[0]));
  try {
    let target: ManagedServerTarget;
    try {
      target = await verifyManagedServerTarget(
        readManagedServerTarget(resolveManagedServerStateFile()),
      );
    } catch {
      serverStart = null;
      routingAvailable = false;
      openStream.disconnect();
      await startServer();
      target = await verifyManagedServerTarget(
        readManagedServerTarget(resolveManagedServerStateFile()),
      );
    }
    await Promise.all(
      [...windows.values()].map((candidate) =>
        candidate.errorDocument ||
        candidate.crashed ||
        candidate.origin !== target.url
          ? candidate.loader.load()
          : Promise.resolve(),
      ),
    );
    await connectStream(target.url);
  } catch (error) {
    appendDesktopSlog("desktop.activate.failed", { message: String(error) });
  }
  focusWindow(entry);
}
