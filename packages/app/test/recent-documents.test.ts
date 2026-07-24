import { describe, expect, it } from "vitest";
import {
  readRecentDocuments,
  removeRecentDocument,
  touchRecentDocument,
  writeRecentDocuments,
} from "../src/recent-documents";
import { MemoryStorage } from "./helpers/memory-storage";

describe("recent document persistence", () => {
  it("orders documents by when they were last viewed and refreshes duplicates", () => {
    const firstView = touchRecentDocument(
      [],
      { path: "/tmp/first.md", modifiedAt: 200 },
      1_000,
    );
    const secondView = touchRecentDocument(
      firstView,
      { path: "/tmp/second.md", modifiedAt: 100 },
      1_000,
    );
    const revisited = touchRecentDocument(
      secondView,
      { path: "/tmp/first.md", modifiedAt: 300 },
      1_000,
    );

    expect(revisited).toEqual([
      { path: "/tmp/first.md", modifiedAt: 300, lastViewedAt: 1_002 },
      { path: "/tmp/second.md", modifiedAt: 100, lastViewedAt: 1_001 },
    ]);
  });

  it("round-trips a bounded recent history", () => {
    const storage = new MemoryStorage();
    const documents = Array.from({ length: 25 }, (_, index) => ({
      path: `/tmp/file-${index}.md`,
      modifiedAt: index,
      lastViewedAt: index,
    }));

    writeRecentDocuments(storage, documents);

    const restored = readRecentDocuments(storage);
    expect(restored).toHaveLength(20);
    expect(restored[0]?.path).toBe("/tmp/file-24.md");
    expect(restored.at(-1)?.path).toBe("/tmp/file-5.md");
  });

  it("keeps the newest view when writing duplicate paths", () => {
    const storage = new MemoryStorage();

    writeRecentDocuments(storage, [
      { path: "/tmp/draft.md", modifiedAt: 100, lastViewedAt: 100 },
      { path: "/tmp/draft.md", modifiedAt: 200, lastViewedAt: 200 },
    ]);

    expect(readRecentDocuments(storage)).toEqual([
      { path: "/tmp/draft.md", modifiedAt: 200, lastViewedAt: 200 },
    ]);
  });

  it("preserves identity when removing a path that is not recent", () => {
    const documents = [
      { path: "/tmp/draft.md", modifiedAt: 100, lastViewedAt: 100 },
    ];

    expect(removeRecentDocument(documents, "/tmp/missing.md")).toBe(documents);
  });

  it.each([
    "not json",
    JSON.stringify([{ path: "", modifiedAt: 1, lastViewedAt: 1 }]),
    JSON.stringify([
      { path: "/tmp/draft.md", modifiedAt: "recent", lastViewedAt: 1 },
    ]),
    JSON.stringify([
      {
        path: "/tmp/draft.md",
        modifiedAt: 1,
        lastViewedAt: 8_640_000_000_000_001,
      },
    ]),
  ])("rejects and clears invalid stored history: %s", (value) => {
    const storage = new MemoryStorage();
    storage.setItem("roughdraft.recent-documents.v1", value);

    expect(readRecentDocuments(storage)).toEqual([]);
    expect(storage.values.size).toBe(0);
  });
});
