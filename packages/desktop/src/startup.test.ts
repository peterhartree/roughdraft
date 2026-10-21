import { describe, expect, it, vi } from "vitest";
import {
  CLAIM_DOCUMENT_CHANNEL,
  OPEN_DOCUMENT_CHANNEL,
  PREPARE_CLOSE_CHANNEL,
  PREPARE_CLOSE_RESULT_CHANNEL,
  WINDOW_READY_CHANNEL,
} from "./window-channels.js";

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  const cliInvocations: Array<{ command: string; args: string[] }> = [];
  const appHandlers = new Map<string, (...args: unknown[]) => void>();
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcListeners = new Map<string, (...args: unknown[]) => void>();
  const menuTemplates: unknown[] = [];
  let openIntent:
    | ((intent: { path: string; modifiedAt: number | null }) => void)
    | null = null;
  let managedServerAvailable = false;

  const recordCliStart = (command: unknown, rawArgs: unknown) => {
    const args = Array.isArray(rawArgs) ? rawArgs.map(String) : [];
    cliInvocations.push({ command: String(command), args });
    events.push("cli-start");
    managedServerAvailable = true;
    return { pid: 1234, status: 0, unref: vi.fn() };
  };

  const spawn = vi.fn((command: unknown, args: unknown) =>
    recordCliStart(command, args),
  );
  const spawnSync = vi.fn((command: unknown, args: unknown) =>
    recordCliStart(command, args),
  );
  const execFile = vi.fn((...args: unknown[]) => {
    const result = recordCliStart(args[0], args[1]);
    const callback = args.find((arg) => typeof arg === "function");
    if (callback) {
      (callback as (error: null, stdout: string, stderr: string) => void)(
        null,
        "",
        "",
      );
    }
    return result;
  });
  const execFileSync = vi.fn((command: unknown, args: unknown) =>
    recordCliStart(command, args),
  );

  class MockBrowserWindow {
    static windows: MockBrowserWindow[] = [];
    static focused: MockBrowserWindow | null = null;

    readonly webContentsHandlers = new Map<
      string,
      (...args: unknown[]) => void
    >();
    readonly windowHandlers = new Map<string, (...args: unknown[]) => void>();
    readonly webContents: {
      mainFrame: { url: string };
      getURL: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      setIgnoreMenuShortcuts: ReturnType<typeof vi.fn>;
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
    };
    private url = "";

    readonly loadURL = vi.fn(async (url: string) => {
      this.url = url;
      this.webContents.mainFrame.url = url;
      events.push(`load-url:${url}`);
    });

    constructor() {
      this.webContents = {
        mainFrame: { url: "" },
        getURL: vi.fn(() => this.url),
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          this.webContentsHandlers.set(event, listener);
        }),
        send: vi.fn(),
        setIgnoreMenuShortcuts: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      };
      MockBrowserWindow.windows.push(this);
    }

    getNormalBounds() {
      return { x: 0, y: 0, width: 1180, height: 900 };
    }
    isMaximized() {
      return false;
    }
    focus() {
      MockBrowserWindow.focused = this;
    }
    isFocused() {
      return MockBrowserWindow.focused === this;
    }
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return false;
    }
    on(event: string, listener: (...args: unknown[]) => void) {
      this.windowHandlers.set(event, listener);
    }
    once(event: string, listener: (...args: unknown[]) => void) {
      this.windowHandlers.set(event, listener);
    }
    restore() {}
    show() {}

    static getAllWindows() {
      return MockBrowserWindow.windows;
    }

    static getFocusedWindow() {
      return MockBrowserWindow.focused;
    }
  }

  const app = {
    isPackaged: true,
    getPath: vi.fn(() => "/tmp/roughdraft-startup-test"),
    isReady: vi.fn(() => true),
    focus: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      appHandlers.set(event, listener);
    }),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    setLoginItemSettings: vi.fn((settings: unknown) => {
      void settings;
      events.push("set-login-item");
    }),
    whenReady: vi.fn(() => Promise.resolve()),
  };

  const serverTarget = {
    isAllowedExternalUrl: vi.fn(() => false),
    isAllowedNavigation: vi.fn(() => true),
    isServedFileNavigation: vi.fn(
      (url: string) => new URL(url).pathname === "/api/files",
    ),
    readManagedServerTarget: vi.fn(() => {
      events.push("load-server-state");
      if (!managedServerAvailable) {
        throw new Error("server state is absent");
      }
      return { port: 7373, url: "http://localhost:7373" };
    }),
    resolveManagedServerStateFile: vi.fn(
      () => "/tmp/roughdraft-test-server.json",
    ),
    verifyManagedServerTarget: vi.fn(async (target: unknown) => target),
  };

  return {
    app,
    BrowserWindow: MockBrowserWindow,
    childProcess: { execFile, execFileSync, spawn, spawnSync },
    cliInvocations,
    dialog: {
      showErrorBox: vi.fn(),
      showMessageBox: vi.fn(async () => ({ response: 0 })),
      showOpenDialog: vi.fn(),
    },
    events,
    ipcHandlers,
    ipcListeners,
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          ipcHandlers.set(channel, handler);
        },
      ),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        ipcListeners.set(channel, listener);
      }),
    },
    Menu: {
      buildFromTemplate: vi.fn((template: unknown) => template),
      setApplicationMenu: vi.fn((template: unknown) => {
        menuTemplates.push(template);
      }),
    },
    menuTemplates,
    get openIntent() {
      return openIntent;
    },
    setOpenIntent(
      listener: (intent: { path: string; modifiedAt: number | null }) => void,
    ) {
      openIntent = listener;
    },
    serverTarget,
    session: {
      defaultSession: {
        setPermissionCheckHandler: vi.fn(),
        setPermissionRequestHandler: vi.fn(),
        flushStorageData: vi.fn(),
        webRequest: { onHeadersReceived: vi.fn() },
      },
    },
    screen: {
      getAllDisplays: vi.fn(() => [
        { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
      ]),
    },
    shell: { openExternal: vi.fn() },
  };
});

vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: mocks.BrowserWindow,
  dialog: mocks.dialog,
  ipcMain: mocks.ipcMain,
  Menu: mocks.Menu,
  screen: mocks.screen,
  session: mocks.session,
  shell: mocks.shell,
}));

vi.mock("./window-session.js", () => ({
  MAX_WINDOWS: 20,
  readWindowSession: () => null,
  writeWindowSession: vi.fn(),
}));
vi.mock("./open-intent-stream.js", () => ({
  createOpenIntentStream: (options: {
    onIntent: (intent: { path: string; modifiedAt: number | null }) => void;
  }) => {
    mocks.setOpenIntent(options.onIntent);
    return { connect: vi.fn(), disconnect: vi.fn() };
  },
}));

vi.mock("node:child_process", () => mocks.childProcess);
vi.mock("./server-target.js", () => mocks.serverTarget);

describe("desktop startup", () => {
  it("starts the managed CLI before loading state when macOS launches without a server", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });

    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ desktopWindowRouting: true }),
      })),
    );
    try {
      await import("./main.js");
      for (let index = 0; index < 30; index += 1) {
        await Promise.resolve();
      }
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
    }

    expect(mocks.app.setLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({ openAtLogin: true }),
    );
    expect(mocks.cliInvocations).toEqual([
      { command: "roughdraft", args: ["start", "--json"] },
    ]);
    expect(mocks.events).toEqual([
      "set-login-item",
      "cli-start",
      "load-server-state",
      "load-url:http://localhost:7373",
    ]);
  });

  it("keeps the close handshake available after redirecting a served file outside the window", async () => {
    const first = mocks.BrowserWindow.windows[0];
    const ready = mocks.ipcListeners.get(WINDOW_READY_CHANNEL);
    const closeResult = mocks.ipcListeners.get(PREPARE_CLOSE_RESULT_CHANNEL);
    const close = first?.windowHandlers.get("close");
    if (!first || !ready || !closeResult || !close) {
      throw new Error("Desktop startup harness was not initialised");
    }
    const senderEvent = {
      sender: first.webContents,
      senderFrame: first.webContents.mainFrame,
    };
    ready(senderEvent);
    first.webContents.send.mockClear();

    const servedFileUrl = "http://localhost:7373/api/files?path=recording.mp3";
    first.webContentsHandlers.get("did-start-navigation")?.(
      {},
      servedFileUrl,
      false,
      true,
    );
    const navigationEvent = { preventDefault: vi.fn() };
    first.webContentsHandlers.get("will-navigate")?.(
      navigationEvent,
      servedFileUrl,
    );
    expect(navigationEvent.preventDefault).toHaveBeenCalledOnce();

    close({ preventDefault: vi.fn() });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    const request = first.webContents.send.mock.calls.find(
      ([channel]) => channel === PREPARE_CLOSE_CHANNEL,
    );
    try {
      expect(request).toBeDefined();
    } finally {
      if (request) closeResult(senderEvent, request[1], false);
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    }
  });

  it("keeps the close handshake available after beforeunload cancels an app navigation", async () => {
    const first = mocks.BrowserWindow.windows[0];
    const ready = mocks.ipcListeners.get(WINDOW_READY_CHANNEL);
    const closeResult = mocks.ipcListeners.get(PREPARE_CLOSE_RESULT_CHANNEL);
    const close = first?.windowHandlers.get("close");
    if (!first || !ready || !closeResult || !close) {
      throw new Error("Desktop startup harness was not initialised");
    }
    const senderEvent = {
      sender: first.webContents,
      senderFrame: first.webContents.mainFrame,
    };
    ready(senderEvent);
    first.webContents.send.mockClear();

    first.webContentsHandlers.get("did-start-navigation")?.(
      {},
      "http://localhost:7373/?path=%2Ftmp%2Fnext.md",
      false,
      true,
    );
    first.webContentsHandlers.get("will-prevent-unload")?.({
      preventDefault: vi.fn(),
    });

    close({ preventDefault: vi.fn() });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    const request = first.webContents.send.mock.calls.find(
      ([channel]) => channel === PREPARE_CLOSE_CHANNEL,
    );
    try {
      expect(request).toBeDefined();
    } finally {
      if (request) closeResult(senderEvent, request[1], false);
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    }
  });

  it("routes a queued intent through ownership again after renderer recovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ desktopWindowRouting: true }),
      })),
    );
    try {
      const first = mocks.BrowserWindow.windows[0];
      const ready = mocks.ipcListeners.get(WINDOW_READY_CHANNEL);
      const claim = mocks.ipcHandlers.get(CLAIM_DOCUMENT_CHANNEL);
      if (!first || !ready || !claim || !mocks.openIntent) {
        throw new Error("Desktop startup harness was not initialised");
      }
      const eventFor = (window: InstanceType<typeof mocks.BrowserWindow>) => ({
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame,
      });
      ready(eventFor(first));

      const template = mocks.menuTemplates.at(-1) as Array<{
        label?: string;
        submenu?: Array<{
          label?: string;
          click?: (...args: unknown[]) => void;
        }>;
      }>;
      const newWindow = template
        .find((item) => item.label === "File")
        ?.submenu?.find((item) => item.label === "New Window");
      newWindow?.click?.();
      for (let index = 0; index < 20; index += 1) await Promise.resolve();

      const second = mocks.BrowserWindow.windows[1];
      if (!second) throw new Error("New Window did not create a renderer");
      ready(eventFor(second));
      first.focus();
      first.webContentsHandlers.get("did-start-navigation")?.(
        {},
        "http://localhost:7373",
        false,
        true,
      );

      const queuedPath = "/tmp/queued-during-crash.md";
      mocks.openIntent({ path: queuedPath, modifiedAt: null });
      first.webContentsHandlers.get("render-process-gone")?.();
      for (let index = 0; index < 20; index += 1) await Promise.resolve();

      expect(claim(eventFor(second), queuedPath)).toMatchObject({
        status: "claimed",
      });
      first.webContentsHandlers.get("did-finish-load")?.();
      ready(eventFor(first));

      expect(first.webContents.send).not.toHaveBeenCalledWith(
        OPEN_DOCUMENT_CHANNEL,
        expect.objectContaining({ path: queuedPath }),
      );
      expect(second.webContents.send).toHaveBeenCalledWith(
        OPEN_DOCUMENT_CHANNEL,
        expect.objectContaining({ path: queuedPath }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("startManagedServer", () => {
  it("marks the CLI start as desktop-managed so the CLI does not relaunch Roughdraft.app", async () => {
    const { startManagedServer } = await import("./startup.js");
    let childEnv: NodeJS.ProcessEnv | undefined;
    mocks.childProcess.execFile.mockImplementationOnce((...args: unknown[]) => {
      childEnv = (args[2] as { env?: NodeJS.ProcessEnv }).env;
      const callback = args.find((arg) => typeof arg === "function");
      (callback as (error: null, stdout: string, stderr: string) => void)(
        null,
        "",
        "",
      );
      return { pid: 1234, status: 0, unref: vi.fn() };
    });

    await startManagedServer({
      env: { PATH: "/usr/bin" },
      homeDir: "/tmp/roughdraft-home",
    });

    expect(childEnv).toMatchObject({ ROUGHDRAFT_DESKTOP_MANAGED: "1" });
  });
});

describe("nextServerLoadRetryDelay", () => {
  it("backs off across failures and gives up after the schedule ends", async () => {
    const { nextServerLoadRetryDelay } = await import("./startup.js");

    expect(nextServerLoadRetryDelay(1)).toBe(2_000);
    expect(nextServerLoadRetryDelay(2)).toBe(5_000);
    expect(nextServerLoadRetryDelay(3)).toBe(10_000);
    expect(nextServerLoadRetryDelay(4)).toBe(20_000);
    expect(nextServerLoadRetryDelay(5)).toBe(30_000);
    expect(nextServerLoadRetryDelay(6)).toBeNull();
  });
});
