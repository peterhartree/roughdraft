import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NativeOpenPathQueue,
  postOpenDocumentIntent,
  resolveMarkdownOpenIntent,
} from "./native-open.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createTemporaryPath(name: string, content = "# Draft\n") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-open-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe("native Markdown open intents", () => {
  it("resolves an existing .md file with its modification time", () => {
    const filePath = createTemporaryPath("draft.md");

    expect(resolveMarkdownOpenIntent(filePath)).toEqual({
      path: filePath,
      modifiedAt: fs.statSync(filePath).mtimeMs,
    });
  });

  it.each([
    ["a non-Markdown file", "draft.txt"],
    ["a missing Markdown file", "missing.md"],
  ])("rejects %s", (_label, filename) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "roughdraft-open-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, filename);
    if (filename.endsWith(".txt")) fs.writeFileSync(filePath, "Draft\n");

    expect(() => resolveMarkdownOpenIntent(filePath)).toThrow(
      /can only open existing \.md files/,
    );
  });

  it("posts the resolved intent to the managed server", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ accepted: true, delivered: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const intent = { path: "/tmp/draft.md", modifiedAt: 123 };

    await expect(
      postOpenDocumentIntent(fetchImpl, "http://localhost:7373", intent),
    ).resolves.toEqual({ delivered: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("http://localhost:7373/api/open-request"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(intent),
      }),
    );
  });

  it("keeps only the newest cold-launch path, then forwards paths immediately", () => {
    const queue = new NativeOpenPathQueue();
    const consume = vi.fn();

    queue.request("/tmp/first.md");
    queue.request("/tmp/second.md");
    expect(consume).not.toHaveBeenCalled();

    queue.connect(consume);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenLastCalledWith("/tmp/second.md");

    queue.request("/tmp/third.md");
    expect(consume).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenLastCalledWith("/tmp/third.md");

    queue.disconnect();
    queue.request("/tmp/fourth.md");
    queue.request("/tmp/fifth.md");
    expect(consume).toHaveBeenCalledTimes(2);

    queue.connect(consume);
    expect(consume).toHaveBeenCalledTimes(3);
    expect(consume).toHaveBeenLastCalledWith("/tmp/fifth.md");
  });
});
