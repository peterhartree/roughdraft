import { describe, expect, it } from "vitest";
import { OpenRequestBroker } from "./open-requests.js";

describe("OpenRequestBroker", () => {
  it("delivers an open intent to the newest connected client", () => {
    const broker = new OpenRequestBroker();
    const first: string[] = [];
    const second: string[] = [];
    broker.connect((intent) => first.push(intent.path));
    broker.connect((intent) => second.push(intent.path));

    expect(broker.request({ path: "/tmp/draft.md" })).toEqual({
      accepted: true,
      delivered: true,
    });
    expect(first).toEqual([]);
    expect(second).toEqual(["/tmp/draft.md"]);
  });

  it("holds a cold-start intent until a client connects", () => {
    const broker = new OpenRequestBroker();

    expect(broker.request({ path: "/tmp/draft.md" })).toEqual({
      accepted: true,
      delivered: false,
    });

    const received: string[] = [];
    broker.connect((intent) => received.push(intent.path));
    expect(received).toEqual(["/tmp/draft.md"]);
  });

  it("keeps only the newest pending intent", () => {
    const broker = new OpenRequestBroker();
    broker.request({ path: "/tmp/first.md" });
    broker.request({ path: "/tmp/latest.md" });

    const received: string[] = [];
    broker.connect((intent) => received.push(intent.path));
    expect(received).toEqual(["/tmp/latest.md"]);
  });

  it("does not replay a consumed intent on reconnect", () => {
    const broker = new OpenRequestBroker();
    broker.request({ path: "/tmp/draft.md" });
    const first: string[] = [];
    const firstConnection = broker.connect((intent) => first.push(intent.path));
    firstConnection.disconnect();

    const second: string[] = [];
    broker.connect((intent) => second.push(intent.path));
    expect(first).toEqual(["/tmp/draft.md"]);
    expect(second).toEqual([]);
  });

  it("stops delivering to disconnected clients", () => {
    const broker = new OpenRequestBroker();
    const disconnected: string[] = [];
    const active: string[] = [];
    const connection = broker.connect((intent) =>
      disconnected.push(intent.path),
    );
    connection.disconnect();
    broker.connect((intent) => active.push(intent.path));

    broker.request({ path: "/tmp/draft.md" });
    expect(disconnected).toEqual([]);
    expect(active).toEqual(["/tmp/draft.md"]);
  });
});
