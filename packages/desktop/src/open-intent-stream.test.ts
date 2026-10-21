import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenIntentStream,
  type OpenDocumentIntent,
} from "./open-intent-stream.js";

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("open-intent stream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("decodes intents split across chunks and rejects malformed events", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
      },
    });
    const received: OpenDocumentIntent[] = [];
    const stream = createOpenIntentStream({
      onIntent: (intent) => received.push(intent),
      fetchImpl: vi.fn(async () =>
        Promise.resolve(
          new Response(body, {
            headers: { "Content-Type": "text/event-stream" },
          }),
        ),
      ),
    });

    stream.connect("http://127.0.0.1:4317");
    await nextTurn();

    const encoded = new TextEncoder().encode(
      'event: open-request\ndata: {"path":"/tmp/café.md","modifiedAt":42,"activate":true}\n\n',
    );
    const splitInsideAccent = encoded.indexOf(0xc3) + 1;
    controller?.enqueue(encoded.slice(0, splitInsideAccent));
    controller?.enqueue(encoded.slice(splitInsideAccent));
    controller?.enqueue(
      new TextEncoder().encode(
        'event: open-request\ndata: {"path":"","modifiedAt":null}\n\n',
      ),
    );
    await nextTurn();

    expect(received).toEqual([
      { path: "/tmp/café.md", modifiedAt: 42, activate: true },
    ]);
    stream.disconnect();
  });

  it("aborts the previous request when the origin changes or disconnects", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal;
        if (!signal) throw new Error("missing signal");
        signals.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      },
    );
    const stream = createOpenIntentStream({ onIntent: () => {}, fetchImpl });

    stream.connect("http://127.0.0.1:4317");
    await nextTurn();
    stream.connect("http://127.0.0.1:4318");
    await nextTurn();

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:4317/api/open-requests?client=desktop&router=1",
      "http://127.0.0.1:4318/api/open-requests?client=desktop&router=1",
    ]);

    stream.disconnect();
    expect(signals[1]?.aborted).toBe(true);
  });

  it("does not dispatch a buffered event after disconnect aborts a pending read", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const received: OpenDocumentIntent[] = [];
    const stream = createOpenIntentStream({
      onIntent: (intent) => received.push(intent),
      fetchImpl: vi.fn(async () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(nextController) {
                controller = nextController;
              },
            }),
          ),
        ),
      ),
    });

    stream.connect("http://127.0.0.1:4317");
    await nextTurn();
    stream.disconnect();
    controller?.enqueue(
      new TextEncoder().encode(
        'event: open-request\ndata: {"path":"/tmp/stale.md","modifiedAt":null}\n\n',
      ),
    );
    await nextTurn();

    expect(received).toEqual([]);
  });

  it("reconnects after the server closes the stream", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        ),
      ),
    );
    const stream = createOpenIntentStream({ onIntent: () => {}, fetchImpl });

    stream.connect("http://127.0.0.1:4317");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stream.disconnect();
  });

  it("reads an SSE event from a local HTTP server", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("event: open-request\r\n");
      response.end('data: {"path":"/tmp/live.md","modifiedAt":null}\r\n\r\n');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("HTTP test server did not bind to a TCP port");
    }

    let resolveIntent: ((intent: OpenDocumentIntent) => void) | undefined;
    const intent = new Promise<OpenDocumentIntent>((resolve) => {
      resolveIntent = resolve;
    });
    const stream = createOpenIntentStream({
      onIntent: (nextIntent) => resolveIntent?.(nextIntent),
    });

    try {
      stream.connect(`http://127.0.0.1:${address.port}`);
      await expect(intent).resolves.toEqual({
        path: "/tmp/live.md",
        modifiedAt: null,
      });
    } finally {
      stream.disconnect();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
