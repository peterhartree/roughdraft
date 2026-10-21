import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseWindowSession,
  readWindowSession,
  writeWindowSession,
} from "./window-session.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createSessionPath(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "roughdraft-window-session-"),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, "nested", "window-session.json");
}

describe("native window sessions", () => {
  it("round-trips window order, bounds, maximized state and focus atomically", () => {
    const filePath = createSessionPath();
    const session = {
      windows: [
        {
          id: "window-a",
          bounds: { x: -1200, y: 40, width: 960, height: 720 },
          maximized: true,
        },
        { id: "window-b" },
      ],
      focusedId: "window-a",
    };

    writeWindowSession(filePath, session);

    expect(readWindowSession(filePath)).toEqual(session);
    expect(fs.readdirSync(path.dirname(filePath))).toEqual([
      "window-session.json",
    ]);
  });

  it.each([
    ["missing files", null],
    ["invalid JSON", "{"],
    ["an empty window list", JSON.stringify({ windows: [] })],
    [
      "duplicate window ids",
      JSON.stringify({ windows: [{ id: "a" }, { id: "a" }] }),
    ],
    [
      "a focus id outside the session",
      JSON.stringify({ windows: [{ id: "a" }], focusedId: "b" }),
    ],
    [
      "more than twenty windows",
      JSON.stringify({
        windows: Array.from({ length: 21 }, (_, index) => ({
          id: `window-${index}`,
        })),
      }),
    ],
    [
      "unusable bounds",
      JSON.stringify({
        windows: [{ id: "a", bounds: { x: 0, y: 0, width: 0, height: 700 } }],
      }),
    ],
  ])("returns null for %s", (_description, contents) => {
    const filePath = createSessionPath();
    if (contents !== null) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents);
    }

    expect(readWindowSession(filePath)).toBeNull();
  });

  it("rejects non-finite and implausible bounds during direct parsing", () => {
    expect(
      parseWindowSession({
        windows: [
          {
            id: "a",
            bounds: { x: Number.NaN, y: 0, width: 900, height: 700 },
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseWindowSession({
        windows: [
          {
            id: "a",
            bounds: { x: 0, y: 0, width: 1_000_000, height: 700 },
          },
        ],
      }),
    ).toBeNull();
  });

  it("validates before replacing an existing session", () => {
    const filePath = createSessionPath();
    const existing = { windows: [{ id: "window-a" }] };
    writeWindowSession(filePath, existing);

    expect(() =>
      writeWindowSession(filePath, {
        windows: [{ id: "window-a" }, { id: "window-a" }],
      }),
    ).toThrow(/Invalid window session/);
    expect(readWindowSession(filePath)).toEqual(existing);
  });
});
