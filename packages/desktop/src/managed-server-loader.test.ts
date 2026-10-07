import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagedServerLoader } from "./managed-server-loader.js";

const SERVER_URL = "http://localhost:7373";

class AbortedLoadError extends Error {
  readonly code = "ERR_ABORTED";
  readonly errno = -3;

  constructor(url: string) {
    super(`ERR_ABORTED (-3) loading '${url}'`);
  }
}

// Mimics Electron's webContents.loadURL: starting a new navigation aborts any
// navigation still in flight, whose promise then rejects with ERR_ABORTED.
class FakePage {
  currentUrl: string | null = null;
  readonly loadedUrls: string[] = [];
  private inFlight: {
    url: string;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  loadURL(url: string): Promise<void> {
    const previous = this.inFlight;
    if (previous) {
      this.inFlight = null;
      previous.reject(new AbortedLoadError(previous.url));
    }
    this.loadedUrls.push(url);

    return new Promise((resolve, reject) => {
      const navigation = { url, resolve, reject };
      this.inFlight = navigation;
      // The page commits on a later turn, leaving room for a competing load.
      setTimeout(() => {
        if (this.inFlight !== navigation) return;
        this.inFlight = null;
        this.currentUrl = url;
        resolve();
      }, 0);
    });
  }
}

function createHarness() {
  const page = new FakePage();
  const errorDocuments: string[] = [];
  const retryTimers: Array<() => void> = [];
  let origin: string | null = null;
  let connected = false;
  let serverAlive = false;
  let serverStarts = 0;

  const loader = createManagedServerLoader<FakePage>({
    resolvePage: () => page,
    startServer: async () => {
      serverStarts += 1;
      serverAlive = true;
    },
    resolveTarget: async () => {
      if (!serverAlive) {
        throw new Error("connect ECONNREFUSED 127.0.0.1:7373");
      }
      return { port: 7373, url: SERVER_URL };
    },
    loadUrl: (target, url) => target.loadURL(url),
    loadErrorDocument: async (target, message) => {
      errorDocuments.push(message);
      await target.loadURL(`data:text/html,${encodeURIComponent(message)}`);
    },
    setOrigin: (next) => {
      origin = next;
    },
    onConnected: () => {
      connected = true;
    },
    onDisconnected: () => {
      connected = false;
    },
    nextRetryDelay: () => 2_000,
    // Retries are recorded but never fired, so only the two requested loads run.
    setTimer: (callback) => {
      retryTimers.push(callback);
      return retryTimers.length;
    },
    clearTimer: () => {},
    slog: () => {},
  });

  return {
    loader,
    page,
    errorDocuments,
    get origin() {
      return origin;
    },
    get connected() {
      return connected;
    },
    get serverStarts() {
      return serverStarts;
    },
    killServer() {
      serverAlive = false;
    },
  };
}

describe("managed server loader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects once when launch and a macOS open-file request load concurrently", async () => {
    const harness = createHarness();

    // createMainWindow() starts the first load; an open-file event arriving
    // before it settles makes ensureNativeOpenDestination() request another.
    const loads = Promise.allSettled([
      harness.loader.load(),
      harness.loader.load(),
    ]);
    // Let every navigation still in flight commit.
    await vi.runAllTimersAsync();
    await loads;

    expect(harness.errorDocuments).toEqual([]);
    expect(harness.origin).toBe(SERVER_URL);
    expect(harness.connected).toBe(true);
    expect(harness.page.currentUrl).toBe(SERVER_URL);
  });

  it("leaves a healthy connection alone when the app is activated", async () => {
    const harness = createHarness();
    const initialLoad = harness.loader.load();
    await vi.runAllTimersAsync();
    await initialLoad;

    const activation = harness.loader.ensureConnected();
    await vi.runAllTimersAsync();
    await activation;

    expect(harness.serverStarts).toBe(1);
    expect(harness.page.loadedUrls).toEqual([SERVER_URL]);
    expect(harness.origin).toBe(SERVER_URL);
    expect(harness.connected).toBe(true);
  });

  it("restarts the server and reloads when activation finds the server gone", async () => {
    const harness = createHarness();
    const initialLoad = harness.loader.load();
    await vi.runAllTimersAsync();
    await initialLoad;
    harness.killServer();

    const activation = harness.loader.ensureConnected();
    await vi.runAllTimersAsync();
    await activation;

    expect(harness.serverStarts).toBe(2);
    expect(harness.errorDocuments).toEqual([]);
    expect(harness.page.loadedUrls).toEqual([SERVER_URL, SERVER_URL]);
    expect(harness.page.currentUrl).toBe(SERVER_URL);
    expect(harness.origin).toBe(SERVER_URL);
    expect(harness.connected).toBe(true);
  });

  it("joins a load already in flight when the app is activated during launch", async () => {
    const harness = createHarness();

    const loads = Promise.allSettled([
      harness.loader.load(),
      harness.loader.ensureConnected(),
    ]);
    await vi.runAllTimersAsync();
    await loads;

    expect(harness.serverStarts).toBe(1);
    expect(harness.errorDocuments).toEqual([]);
    expect(harness.page.loadedUrls).toEqual([SERVER_URL]);
    expect(harness.connected).toBe(true);
  });
});
