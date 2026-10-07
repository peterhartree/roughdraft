import type { ManagedServerTarget } from "./server-target.js";

export interface ManagedServerLoaderDeps<Page> {
  // Returns the page to load into, or null when there is no usable window.
  resolvePage: () => Page | null;
  startServer: () => Promise<void>;
  // Reads and verifies the managed server target; may throw synchronously.
  resolveTarget: () => Promise<ManagedServerTarget> | ManagedServerTarget;
  loadUrl: (page: Page, url: string) => Promise<void>;
  loadErrorDocument: (page: Page, message: string) => Promise<void>;
  setOrigin: (origin: string | null) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  nextRetryDelay: (failures: number) => number | null;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (handle: unknown) => void;
  slog: (event: string, data?: Record<string, unknown>) => void;
}

export interface ManagedServerLoader {
  load(): Promise<void>;
  // Reloads only when the connected server has gone away.
  ensureConnected(): Promise<void>;
}

export function createManagedServerLoader<Page>(
  deps: ManagedServerLoaderDeps<Page>,
): ManagedServerLoader {
  let failures = 0;
  let retryTimer: unknown = null;
  let inFlight: Promise<void> | null = null;

  function cancelRetry(): void {
    if (retryTimer === null) return;
    deps.clearTimer(retryTimer);
    retryTimer = null;
  }

  // Launch and an early open-file event can both ask for the server. A
  // second loadURL would abort the first, and each failure path loads the
  // error document over the other, so later callers join the attempt in
  // flight instead of starting their own.
  function load(): Promise<void> {
    inFlight ??= attemptLoad().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function attemptLoad(): Promise<void> {
    cancelRetry();
    const page = deps.resolvePage();
    if (page === null) return;

    try {
      await deps.startServer();
      const target = await deps.resolveTarget();
      deps.slog("desktop.server-target.verified", { port: target.port });
      failures = 0;
      deps.setOrigin(target.url);
      await deps.loadUrl(page, target.url);
      deps.onConnected();
    } catch (error) {
      deps.setOrigin(null);
      deps.onDisconnected();
      const message = error instanceof Error ? error.message : String(error);
      failures += 1;
      const retryDelayMs = deps.nextRetryDelay(failures);
      deps.slog("desktop.server-target.failed", {
        message,
        failures,
        retryDelayMs,
      });
      if (retryDelayMs !== null) {
        retryTimer = deps.setTimer(() => {
          retryTimer = null;
          void load();
        }, retryDelayMs);
      }
      await deps.loadErrorDocument(page, message);
    }
  }

  async function ensureConnected(): Promise<void> {
    if (inFlight) return inFlight;
    try {
      await deps.resolveTarget();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.slog("desktop.server-target.lost", { message });
      await load();
    }
  }

  return { load, ensureConnected };
}
