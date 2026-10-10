import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index";

// Every test renames real files inside its own temporary directory.
let tempDir: string;

beforeEach(() => {
  tempDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-rename-")),
  );
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

function rename(body: Record<string, unknown>) {
  const { app } = createApp({ homeDir: tempDir, staticDirPath: tempDir });
  return request(app).post("/api/markdown-file/rename").send(body);
}

describe("POST /api/markdown-file/rename", () => {
  it("renames the file within its folder and keeps its contents", async () => {
    const file = write("notes/draft.md", "# Draft\n");

    const response = await rename({ path: file, name: "plan.md" });

    const renamed = path.join(tempDir, "notes", "plan.md");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ path: renamed });
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(renamed, "utf-8")).toBe("# Draft\n");
  });

  it("refuses to replace another file", async () => {
    const file = write("draft.md", "# Draft\n");
    const other = write("plan.md", "# Plan\n");

    const response = await rename({ path: file, name: "plan.md" });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(
      "A file named plan.md already exists in this folder.",
    );
    expect(fs.readFileSync(file, "utf-8")).toBe("# Draft\n");
    expect(fs.readFileSync(other, "utf-8")).toBe("# Plan\n");
  });

  it("allows a change of letter case alone", async () => {
    const file = write("plan.md");

    const response = await rename({ path: file, name: "Plan.md" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ path: path.join(tempDir, "Plan.md") });
    expect(fs.readdirSync(tempDir)).toEqual(["Plan.md"]);
  });

  it("treats the unchanged name as a no-op", async () => {
    const file = write("plan.md");

    const response = await rename({ path: file, name: "plan.md" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ path: file });
    expect(fs.existsSync(file)).toBe(true);
  });

  it.each([
    ["empty", "  ", "Enter a file name."],
    ["a path", "../plan.md", "File names can't contain slashes."],
    ["not Markdown", "plan.txt", "File names must end in .md."],
    ["only an extension", ".md", "File names must end in .md."],
  ])("returns 400 when the new name is %s", async (_label, name, message) => {
    const file = write("draft.md");

    const response = await rename({ path: file, name });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: message });
    expect(fs.existsSync(file)).toBe(true);
  });

  it.each([
    ["missing", {}],
    ["relative", { path: "notes/draft.md", name: "plan.md" }],
    ["missing a name", { path: "/tmp/draft.md" }],
  ])("returns 400 when the request is %s", async (_label, body) => {
    const response = await rename(body);

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual(expect.any(String));
  });

  it.each([
    ["not Markdown", () => write("notes.txt")],
    ["missing", () => path.join(tempDir, "absent.md")],
  ])("returns 404 when the source is %s", async (_label, source) => {
    const response = await rename({ path: source(), name: "plan.md" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Markdown file not found" });
  });
});
