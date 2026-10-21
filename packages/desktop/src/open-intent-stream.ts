export interface OpenDocumentIntent {
  path: string;
  modifiedAt: number | null;
  activate?: boolean;
}

type Slog = (event: string, data?: Record<string, unknown>) => void;

interface CreateOpenIntentStreamOptions {
  onIntent: (intent: OpenDocumentIntent) => void;
  slog?: Slog;
  fetchImpl?: typeof fetch;
}

export interface OpenIntentStream {
  connect: (origin: string) => void;
  disconnect: () => void;
}

const MAX_BUFFER_LENGTH = 64 * 1024;
const RECONNECT_DELAY_MS = 1_000;

function parseIntent(data: string): OpenDocumentIntent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.path !== "string" || candidate.path.trim() === "") {
    return null;
  }
  if (
    candidate.modifiedAt !== null &&
    (typeof candidate.modifiedAt !== "number" ||
      !Number.isFinite(candidate.modifiedAt))
  ) {
    return null;
  }
  if (
    candidate.activate !== undefined &&
    typeof candidate.activate !== "boolean"
  ) {
    return null;
  }

  return {
    path: candidate.path,
    modifiedAt: candidate.modifiedAt,
    ...(candidate.activate === undefined
      ? {}
      : { activate: candidate.activate }),
  };
}

function eventBoundary(
  buffer: string,
): { index: number; length: number } | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

function eventData(rawEvent: string): { event: string; data: string } {
  let event = "message";
  const data: string[] = [];

  for (const line of rawEvent.split(/\r\n|\r|\n/)) {
    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }

  return { event, data: data.join("\n") };
}

export function createOpenIntentStream({
  onIntent,
  slog = () => {},
  fetchImpl = fetch,
}: CreateOpenIntentStreamOptions): OpenIntentStream {
  let targetOrigin: string | null = null;
  let generation = 0;
  let activeController: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function stopCurrentConnection(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    activeController?.abort();
    activeController = null;
  }

  function scheduleReconnect(connectionGeneration: number): void {
    if (
      connectionGeneration !== generation ||
      targetOrigin === null ||
      reconnectTimer !== null
    ) {
      return;
    }

    slog("desktop.open-intent-stream.reconnect-scheduled", {
      delayMs: RECONNECT_DELAY_MS,
    });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      start(connectionGeneration);
    }, RECONNECT_DELAY_MS);
  }

  async function read(connectionGeneration: number): Promise<void> {
    const origin = targetOrigin;
    if (origin === null || connectionGeneration !== generation) return;

    const controller = new AbortController();
    activeController = controller;
    const endpoint = new URL(
      "/api/open-requests?client=desktop&router=1",
      origin,
    );
    slog("desktop.open-intent-stream.connecting", { origin: endpoint.origin });

    try {
      const response = await fetchImpl(endpoint, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (connectionGeneration !== generation || controller.signal.aborted) {
        return;
      }
      if (!response.ok) {
        throw new Error(`Open-intent stream returned HTTP ${response.status}.`);
      }
      if (!response.body) {
        throw new Error("Open-intent stream response had no body.");
      }

      slog("desktop.open-intent-stream.connected", {
        origin: endpoint.origin,
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (
          connectionGeneration === generation &&
          !controller.signal.aborted
        ) {
          const { done, value } = await reader.read();
          if (
            connectionGeneration !== generation ||
            controller.signal.aborted
          ) {
            return;
          }
          if (done) {
            buffer += decoder.decode();
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          let boundary = eventBoundary(buffer);
          while (boundary) {
            if (
              connectionGeneration !== generation ||
              controller.signal.aborted
            ) {
              return;
            }
            const rawEvent = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary.length);
            if (rawEvent.length > MAX_BUFFER_LENGTH) {
              slog("desktop.open-intent-stream.event-rejected", {
                reason: "too-large",
              });
            } else {
              const parsed = eventData(rawEvent);
              if (parsed.event === "open-request") {
                const intent = parseIntent(parsed.data);
                if (intent) {
                  try {
                    onIntent(intent);
                  } catch (error) {
                    slog("desktop.open-intent-stream.handler-failed", {
                      message:
                        error instanceof Error ? error.message : String(error),
                    });
                  }
                } else {
                  slog("desktop.open-intent-stream.event-rejected", {
                    reason: "invalid-intent",
                  });
                }
              }
            }
            boundary = eventBoundary(buffer);
          }

          if (buffer.length > MAX_BUFFER_LENGTH) {
            buffer = "";
            slog("desktop.open-intent-stream.event-rejected", {
              reason: "too-large",
            });
          }
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      if (activeController === controller) activeController = null;
    }
  }

  function start(connectionGeneration: number): void {
    void read(connectionGeneration).then(
      () => {
        if (connectionGeneration === generation && targetOrigin !== null) {
          slog("desktop.open-intent-stream.disconnected");
          scheduleReconnect(connectionGeneration);
        }
      },
      (error: unknown) => {
        if (connectionGeneration !== generation || targetOrigin === null)
          return;
        slog("desktop.open-intent-stream.disconnected", {
          message: error instanceof Error ? error.message : String(error),
        });
        scheduleReconnect(connectionGeneration);
      },
    );
  }

  return {
    connect(origin: string): void {
      const normalizedOrigin = new URL(origin).origin;
      if (normalizedOrigin === targetOrigin) return;

      generation += 1;
      stopCurrentConnection();
      targetOrigin = normalizedOrigin;
      start(generation);
    },

    disconnect(): void {
      if (targetOrigin === null) return;
      targetOrigin = null;
      generation += 1;
      stopCurrentConnection();
      slog("desktop.open-intent-stream.stopped");
    },
  };
}
