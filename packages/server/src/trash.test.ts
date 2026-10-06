import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index";
import {
  MACOS_TRASH_BINARY,
  moveToTrash,
  OSASCRIPT_TRASH_ARGS,
  UNSUPPORTED_PLATFORM_MESSAGE,
} from "./trash";

// Every test works inside its own temporary directory. No test calls the real
// trash commands: the runner is always injected.
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-trash-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function write(relativePath: string, content = "# Note\n"): string {
  const absolutePath = path.join(tempDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
  return absolutePath;
}

interface RecordedCall {
  command: string;
  args: string[];
}

/** A runner that records its call and removes the file, as a real tool would. */
function recordingRunner(filePath: string, calls: RecordedCall[]) {
  return async (command: string, args: string[]) => {
    calls.push({ command, args });
    fs.rmSync(filePath);
  };
}

describe("moveToTrash", () => {
  it("uses /usr/bin/trash on macOS when it is installed", async () => {
    const file = write("plan.md");
    const calls: RecordedCall[] = [];

    await moveToTrash(file, {
      platform: "darwin",
      exists: (candidate) => candidate === MACOS_TRASH_BINARY,
      run: recordingRunner(file, calls),
    });

    expect(calls).toEqual([{ command: MACOS_TRASH_BINARY, args: [file] }]);
  });

  it("falls back to Finder via osascript, passing the path as its own argv item", async () => {
    const file = write(`it's "quoted" \\ name.md`);
    const calls: RecordedCall[] = [];

    await moveToTrash(file, {
      platform: "darwin",
      exists: () => false,
      run: recordingRunner(file, calls),
    });

    expect(calls).toEqual([
      { command: "osascript", args: [...OSASCRIPT_TRASH_ARGS, file] },
    ]);
    const scriptLines = calls[0].args.filter((_arg, index) => index % 2 === 1);
    expect(scriptLines.join("\n")).not.toContain(path.basename(file));
  });

  it("uses gio trash on Linux", async () => {
    const file = write("plan.md");
    const calls: RecordedCall[] = [];

    await moveToTrash(file, {
      platform: "linux",
      run: recordingRunner(file, calls),
    });

    expect(calls).toEqual([{ command: "gio", args: ["trash", file] }]);
  });

  it("refuses unsupported platforms without running anything", async () => {
    const file = write("plan.md");
    const calls: RecordedCall[] = [];

    await expect(
      moveToTrash(file, {
        platform: "win32",
        run: recordingRunner(file, calls),
      }),
    ).rejects.toThrow(UNSUPPORTED_PLATFORM_MESSAGE);
    expect(calls).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("fails when the command exits cleanly but leaves the file in place", async () => {
    const file = write("plan.md");

    await expect(
      moveToTrash(file, { platform: "linux", run: async () => {} }),
    ).rejects.toThrow("Couldn't move plan.md to the Trash");
  });

  it("reports the command's failure in a readable message", async () => {
    const file = write("plan.md");

    await expect(
      moveToTrash(file, {
        platform: "linux",
        run: async () => {
          throw new Error("gio: Operation not supported");
        },
      }),
    ).rejects.toThrow(
      "Couldn't move plan.md to the Trash: gio: Operation not supported",
    );
  });
});

describe("POST /api/markdown-file/trash", () => {
  function appWith(trashFile: (absolutePath: string) => Promise<void>) {
    return createApp({
      homeDir: tempDir,
      staticDirPath: tempDir,
      trashFile,
    }).app;
  }

  function recordTrash(trashed: string[]) {
    return async (absolutePath: string) => {
      trashed.push(absolutePath);
    };
  }

  it.each([
    ["missing", {}],
    ["not a string", { path: 42 }],
    ["relative", { path: "notes/plan.md" }],
  ])("returns 400 when the path is %s", async (_label, body) => {
    const trashed: string[] = [];

    const response = await request(appWith(recordTrash(trashed)))
      .post("/api/markdown-file/trash")
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual(expect.any(String));
    expect(trashed).toEqual([]);
  });

  it.each([
    ["not Markdown", () => write("notes.txt")],
    ["missing", () => path.join(tempDir, "absent.md")],
    [
      "a directory",
      () => {
        const directory = path.join(tempDir, "folder.md");
        fs.mkdirSync(directory);
        return directory;
      },
    ],
  ])("returns 404 when the target is %s", async (_label, target) => {
    const trashed: string[] = [];

    const response = await request(appWith(recordTrash(trashed)))
      .post("/api/markdown-file/trash")
      .send({ path: target() });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Markdown file not found" });
    expect(trashed).toEqual([]);
  });

  it("trashes the resolved absolute path, accepting any .md case", async () => {
    const file = write("notes/Plan.MD");
    const trashed: string[] = [];

    const response = await request(appWith(recordTrash(trashed)))
      .post("/api/markdown-file/trash")
      .send({ path: path.join(tempDir, "notes", "..", "notes", "Plan.MD") });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ path: file });
    expect(trashed).toEqual([file]);
  });

  it("returns 500 with the error message when trashing fails", async () => {
    const file = write("plan.md");

    const response = await request(
      appWith(async () => {
        throw new Error("Couldn't move plan.md to the Trash: denied");
      }),
    )
      .post("/api/markdown-file/trash")
      .send({ path: file });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Couldn't move plan.md to the Trash: denied",
    });
    expect(fs.existsSync(file)).toBe(true);
  });
});
