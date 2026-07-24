import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./index.js";

describe("open-file modification metadata", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-files-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns the filesystem modification time with a markdown document", async () => {
    const filePath = path.join(projectDir, "draft.md");
    const modifiedAt = new Date("2026-07-20T08:30:00.000Z");
    fs.writeFileSync(filePath, "# Draft\n");
    fs.utimesSync(filePath, modifiedAt, modifiedAt);

    const { app } = createApp({ staticDirPath: projectDir });
    const response = await request(app).get("/api/markdown-file").query({
      projectPath: projectDir,
      path: "draft.md",
    });

    expect(response.status).toBe(200);
    expect(response.body.modifiedAt).toBe(modifiedAt.getTime());
  });

  it("does not inspect paths submitted to the open-request endpoint", async () => {
    const filePath = path.join(projectDir, "private.txt");
    fs.writeFileSync(filePath, "private\n");
    const statSpy = vi.spyOn(fs.promises, "stat");

    const { app } = createApp({ staticDirPath: projectDir });
    const response = await request(app)
      .post("/api/open-request")
      .send({ path: filePath });

    expect(response.status).toBe(200);
    expect(statSpy).not.toHaveBeenCalled();
  });
});
