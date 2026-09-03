import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  const cliInvocations: Array<{ command: string; args: string[] }> = [];
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

    readonly webContents = {
      getURL: vi.fn(() => ""),
      on: vi.fn(),
      setIgnoreMenuShortcuts: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };

    readonly loadURL = vi.fn(async (url: string) => {
      events.push(`load-url:${url}`);
    });

    constructor() {
      MockBrowserWindow.windows.push(this);
    }

    focus() {}
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return false;
    }
    on() {}
    once() {}
    restore() {}
    show() {}

    static getAllWindows() {
      return MockBrowserWindow.windows;
    }
  }

  const app = {
    isPackaged: true,
    isReady: vi.fn(() => true),
    on: vi.fn(),
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
    dialog: { showErrorBox: vi.fn(), showOpenDialog: vi.fn() },
    events,
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    Menu: {
      buildFromTemplate: vi.fn((template: unknown) => template),
      setApplicationMenu: vi.fn(),
    },
    serverTarget,
    session: {
      defaultSession: {
        setPermissionCheckHandler: vi.fn(),
        setPermissionRequestHandler: vi.fn(),
        webRequest: { onHeadersReceived: vi.fn() },
      },
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
  session: mocks.session,
  shell: mocks.shell,
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

    try {
      await import("./main.js");
      for (let index = 0; index < 6; index += 1) {
        await Promise.resolve();
      }
    } finally {
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
