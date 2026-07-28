import { describe, expect, it } from "vitest";
import { DOCUMENT_VIEW_STATE_MAX_AGE_MS } from "../src/document-view-state";
import {
  clearOpenFileSession,
  readOpenFileSession,
  writeOpenFileSession,
} from "../src/open-file-session";
import { MemoryStorage } from "./helpers/memory-storage";

describe("open-file session persistence", () => {
  it("round-trips the active file and ordered sidebar state", () => {
    const storage = new MemoryStorage();
    const session = {
      activePath: "/tmp/newer.md",
      files: [
        {
          path: "/tmp/newer.md",
          modifiedAt: 200,
          openedAt: 2_000,
          unread: false,
        },
        {
          path: "/tmp/older.md",
          modifiedAt: 100,
          openedAt: 1_000,
          unread: true,
        },
      ],
    };

    writeOpenFileSession(storage, session);

    expect(readOpenFileSession(storage)).toEqual(session);
  });

  it("restores a legacy session without open times in its stored order", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "roughdraft.open-file-session.v1",
      JSON.stringify({
        activePath: "/tmp/second.md",
        files: [
          { path: "/tmp/first.md", modifiedAt: 300, unread: false },
          { path: "/tmp/second.md", modifiedAt: 200, unread: false },
          { path: "/tmp/third.md", modifiedAt: 100, unread: true },
        ],
      }),
    );

    const restored = readOpenFileSession(storage, 10_000);
    expect(restored?.files.map((file) => file.path)).toEqual([
      "/tmp/first.md",
      "/tmp/second.md",
      "/tmp/third.md",
    ]);
    const openTimes = restored?.files.map((file) => file.openedAt) ?? [];
    expect([...openTimes].sort((a, b) => b - a)).toEqual(openTimes);
    expect(new Set(openTimes).size).toBe(openTimes.length);
  });

  it.each([
    "not json",
    JSON.stringify({ activePath: "", files: [] }),
    JSON.stringify({ activePath: "/tmp/missing.md", files: [] }),
    JSON.stringify({
      activePath: "/tmp/draft.md",
      files: [{ path: "/tmp/draft.md", modifiedAt: "recent" }],
    }),
    JSON.stringify({
      activePath: "/tmp/draft.md",
      files: [
        {
          path: "/tmp/draft.md",
          modifiedAt: 100,
          openedAt: "recent",
          unread: false,
        },
      ],
    }),
  ])("rejects and clears invalid stored state: %s", (value) => {
    const storage = new MemoryStorage();
    storage.setItem("roughdraft.open-file-session.v1", value);

    expect(readOpenFileSession(storage)).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  it("clears a stored session explicitly", () => {
    const storage = new MemoryStorage();
    storage.setItem("roughdraft.open-file-session.v1", "stored");

    clearOpenFileSession(storage);

    expect(storage.values.size).toBe(0);
  });

  it("rejects an oversized stored payload before parsing", () => {
    const storage = new MemoryStorage();
    storage.setItem("roughdraft.open-file-session.v1", "{".repeat(1_000_001));

    expect(readOpenFileSession(storage)).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  it("bounds large sessions while retaining the active file", () => {
    const storage = new MemoryStorage();
    const files = Array.from({ length: 101 }, (_, index) => ({
      path: `/tmp/file-${index}.md`,
      modifiedAt: 101 - index,
      openedAt: 1_000 + (101 - index),
      unread: index > 0,
    }));

    writeOpenFileSession(storage, {
      activePath: files[100]?.path ?? "",
      files,
    });

    const restored = readOpenFileSession(storage);
    expect(restored?.files).toHaveLength(100);
    expect(restored?.activePath).toBe("/tmp/file-100.md");
    expect(restored?.files.at(-1)?.path).toBe("/tmp/file-100.md");
  });

  it("restores fresh per-file cursor and scroll state", () => {
    const storage = new MemoryStorage();
    const capturedAt = new Date("2026-07-20T08:00:00.000Z").getTime();
    const session = {
      activePath: "/tmp/draft.md",
      files: [
        {
          path: "/tmp/draft.md",
          modifiedAt: 100,
          openedAt: 1_000,
          unread: false,
        },
      ],
      viewStates: {
        "/tmp/draft.md": {
          capturedAt,
          scrollTop: 420,
          editor: { mode: "code" as const, anchor: 80, head: 80 },
        },
      },
    };

    writeOpenFileSession(storage, session, capturedAt);

    expect(readOpenFileSession(storage, capturedAt)).toEqual(session);
  });

  it("forgets expired positions without discarding the open-file session", () => {
    const storage = new MemoryStorage();
    const capturedAt = new Date("2026-07-20T08:00:00.000Z").getTime();
    const session = {
      activePath: "/tmp/draft.md",
      files: [
        {
          path: "/tmp/draft.md",
          modifiedAt: 100,
          openedAt: 1_000,
          unread: false,
        },
      ],
      viewStates: {
        "/tmp/draft.md": {
          capturedAt,
          scrollTop: 420,
          editor: { mode: "rich-text" as const, anchor: 8, head: 8 },
        },
      },
    };
    writeOpenFileSession(storage, session, capturedAt);

    expect(
      readOpenFileSession(
        storage,
        capturedAt + DOCUMENT_VIEW_STATE_MAX_AGE_MS + 1,
      ),
    ).toEqual({ activePath: session.activePath, files: session.files });
  });
});
