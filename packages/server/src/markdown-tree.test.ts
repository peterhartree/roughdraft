import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index";
import {
  listMarkdownTree,
  markdownTreeForFile,
  markdownTreeForRoot,
  resolveMarkdownProject,
} from "./markdown-tree";

// Each test gets a fresh temporary directory that also acts as the home
// directory, so upward walks stop inside it and never see the real machine.
let homeDir: string;

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-tree-"));
});

afterEach(() => {
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function write(relativePath: string, content = "# Note\n"): string {
  const absolutePath = path.join(homeDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
  return absolutePath;
}

function filePaths(listing: { files: { path: string }[] }): string[] {
  return listing.files.map((file) => file.path);
}

describe("resolveMarkdownProject", () => {
  it("uses the nearest ancestor with a .git directory", async () => {
    fs.mkdirSync(path.join(homeDir, "repo", ".git"), { recursive: true });
    const file = write("repo/docs/plans/plan.md");

    expect(await resolveMarkdownProject(file, homeDir)).toEqual({
      root: path.join(homeDir, "repo"),
      kind: "git",
    });
  });

  it("accepts a .git file, as used by worktrees and submodules", async () => {
    write("worktree/.git", "gitdir: /elsewhere/.git/worktrees/worktree\n");
    const file = write("worktree/notes/todo.md");

    expect(await resolveMarkdownProject(file, homeDir)).toEqual({
      root: path.join(homeDir, "worktree"),
      kind: "git",
    });
  });

  it("falls back to the file's directory when no git root exists", async () => {
    const file = write("loose/notes/todo.md");

    expect(await resolveMarkdownProject(file, homeDir)).toEqual({
      root: path.join(homeDir, "loose", "notes"),
      kind: "folder",
    });
  });

  it("never treats the home directory as a git root", async () => {
    fs.mkdirSync(path.join(homeDir, ".git"));
    const file = write("notes/todo.md");

    expect(await resolveMarkdownProject(file, homeDir)).toEqual({
      root: path.join(homeDir, "notes"),
      kind: "folder",
    });
  });
});

describe("listMarkdownTree", () => {
  it("lists only Markdown files, matching the extension case-insensitively", async () => {
    write("a.md");
    write("B.MD");
    write("nested/deeper/c.Md");
    write("readme.txt");
    write("notes.markdown");
    write("nested/image.png");
    fs.mkdirSync(path.join(homeDir, "folder.md"));
    fs.mkdirSync(path.join(homeDir, "empty"));

    const listing = await listMarkdownTree(homeDir, { kind: "folder" });

    expect(filePaths(listing)).toEqual(["a.md", "B.MD", "nested/deeper/c.Md"]);
    expect(listing).toMatchObject({
      root: homeDir,
      name: path.basename(homeDir),
      kind: "folder",
      truncated: false,
    });
  });

  it("reports each file's modification time", async () => {
    const file = write("dated.md");
    const modifiedAt = new Date("2026-01-02T03:04:05.000Z");
    fs.utimesSync(file, modifiedAt, modifiedAt);

    const listing = await listMarkdownTree(homeDir, { kind: "folder" });

    expect(listing.files).toEqual([
      { path: "dated.md", modifiedAt: modifiedAt.getTime() },
    ]);
  });

  it("skips dependency, build and cache directories but keeps other dot-folders", async () => {
    for (const ignored of [
      ".git",
      "node_modules",
      "packages/app/node_modules/pkg",
      "dist",
      "build",
      "out",
      ".next",
      ".venv",
      "__pycache__",
      "target",
      "coverage",
      ".Trash",
      "Library",
    ]) {
      write(`${ignored}/hidden.md`);
    }
    write(".context/plan.md");
    write(".claude/notes.md");
    write("packages/app/README.md");

    const listing = await listMarkdownTree(homeDir, { kind: "folder" });

    expect(filePaths(listing)).toEqual([
      ".claude/notes.md",
      ".context/plan.md",
      "packages/app/README.md",
    ]);
  });

  it("skips symlinked files and directories, including cycles", async () => {
    write("real/note.md");
    write("outside/elsewhere.md");
    fs.symlinkSync(
      path.join(homeDir, "real", "note.md"),
      path.join(homeDir, "linked-note.md"),
    );
    fs.symlinkSync(
      path.join(homeDir, "outside"),
      path.join(homeDir, "real", "linked-dir"),
    );
    fs.symlinkSync(homeDir, path.join(homeDir, "real", "loop"));

    const listing = await listMarkdownTree(path.join(homeDir, "real"), {
      kind: "folder",
    });

    expect(filePaths(listing)).toEqual(["note.md"]);
  });

  it("truncates once the file cap is reached", async () => {
    write("one.md");
    write("two.md");
    write("sub/three.md");

    const listing = await listMarkdownTree(homeDir, {
      kind: "folder",
      limits: { maxFiles: 2 },
    });

    expect(filePaths(listing)).toEqual(["one.md", "two.md"]);
    expect(listing.truncated).toBe(true);
  });

  it("does not report truncation when the file count equals the cap", async () => {
    write("one.md");
    write("two.md");

    const listing = await listMarkdownTree(homeDir, {
      kind: "folder",
      limits: { maxFiles: 2 },
    });

    expect(listing.truncated).toBe(false);
  });

  it("truncates once the directory cap is reached", async () => {
    write("top.md");
    write("sub/nested.md");

    const listing = await listMarkdownTree(homeDir, {
      kind: "folder",
      limits: { maxDirectories: 1 },
    });

    expect(filePaths(listing)).toEqual(["top.md"]);
    expect(listing.truncated).toBe(true);
  });
});

describe("markdownTreeForFile", () => {
  it("lists the whole git project around the file", async () => {
    fs.mkdirSync(path.join(homeDir, "repo", ".git"), { recursive: true });
    write("repo/README.md");
    const file = write("repo/docs/guide.md");

    const listing = await markdownTreeForFile(file, homeDir);

    expect(listing).toMatchObject({
      root: path.join(homeDir, "repo"),
      name: "repo",
      kind: "git",
    });
    expect(filePaths(listing)).toEqual(["docs/guide.md", "README.md"]);
  });

  it("lists only direct Markdown files for a loose file in the home directory", async () => {
    const file = write("loose.md");
    write("another.md");
    write("Documents/deep.md");

    const listing = await markdownTreeForFile(file, homeDir);

    expect(listing).toMatchObject({ root: homeDir, kind: "folder" });
    expect(filePaths(listing)).toEqual(["another.md", "loose.md"]);
  });

  it("walks recursively for a folder fallback below the home directory", async () => {
    const file = write("notes/today.md");
    write("notes/archive/old.md");

    const listing = await markdownTreeForFile(file, homeDir);

    expect(listing).toMatchObject({
      root: path.join(homeDir, "notes"),
      kind: "folder",
    });
    expect(filePaths(listing)).toEqual(["archive/old.md", "today.md"]);
  });
});

describe("markdownTreeForRoot", () => {
  it("marks a pinned folder as git only when it holds .git itself", async () => {
    fs.mkdirSync(path.join(homeDir, "repo", ".git"), { recursive: true });
    write("repo/sub/note.md");

    expect((await markdownTreeForRoot(path.join(homeDir, "repo"))).kind).toBe(
      "git",
    );
    expect(
      (await markdownTreeForRoot(path.join(homeDir, "repo", "sub"))).kind,
    ).toBe("folder");
  });
});

describe("GET /api/markdown-tree", () => {
  function app() {
    return createApp({ homeDir, staticDirPath: homeDir }).app;
  }

  it("lists the project for a file", async () => {
    fs.mkdirSync(path.join(homeDir, "repo", ".git"), { recursive: true });
    const file = write("repo/notes/plan.md");

    const response = await request(app())
      .get("/api/markdown-tree")
      .query({ file });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      root: path.join(homeDir, "repo"),
      name: "repo",
      kind: "git",
      files: [{ path: "notes/plan.md", modifiedAt: expect.any(Number) }],
      truncated: false,
    });
  });

  it("lists a pinned folder", async () => {
    write("pinned/idea.md");

    const response = await request(app())
      .get("/api/markdown-tree")
      .query({ root: path.join(homeDir, "pinned") });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      root: path.join(homeDir, "pinned"),
      name: "pinned",
      kind: "folder",
      truncated: false,
    });
    expect(filePaths(response.body)).toEqual(["idea.md"]);
  });

  it.each([
    ["neither parameter", {}],
    ["both parameters", { file: "/a/b.md", root: "/a" }],
    ["a relative file", { file: "notes/plan.md" }],
    ["a relative root", { root: "notes" }],
  ])("rejects %s with 400", async (_label, query) => {
    const response = await request(app())
      .get("/api/markdown-tree")
      .query(query);

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual(expect.any(String));
  });

  it("rejects a repeated parameter with 400", async () => {
    const response = await request(app()).get(
      `/api/markdown-tree?root=${encodeURIComponent(homeDir)}&root=${encodeURIComponent(homeDir)}`,
    );

    expect(response.status).toBe(400);
  });

  it.each([
    ["a missing file", () => path.join(homeDir, "missing.md")],
    ["a non-Markdown file", () => write("notes.txt")],
  ])("returns 404 for %s", async (_label, makeFile) => {
    const response = await request(app())
      .get("/api/markdown-tree")
      .query({ file: makeFile() });

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual(expect.any(String));
  });

  it.each([
    ["a missing directory", () => path.join(homeDir, "missing")],
    ["a file", () => write("plain.md")],
  ])("returns 404 for a root that is %s", async (_label, makeRoot) => {
    const response = await request(app())
      .get("/api/markdown-tree")
      .query({ root: makeRoot() });

    expect(response.status).toBe(404);
  });
});
