import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiBackend } from "./api-backend";
import {
  MarkdownFileNotFoundError,
  MarkdownFilePermissionError,
} from "./storage";

describe("ApiBackend.getMarkdownFile", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function backend() {
    return new ApiBackend({
      kind: "local-files",
      label: "Local file",
      detail: "/work",
      projectPath: "/work",
    });
  }

  it("identifies a missing file as permanently unavailable", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 404 }));

    await expect(
      backend().getMarkdownFile("missing.md"),
    ).rejects.toBeInstanceOf(MarkdownFileNotFoundError);
  });

  it("does not classify a transient server failure as a missing file", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 500 }));

    const error = await backend()
      .getMarkdownFile("available.md")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MarkdownFileNotFoundError);
    expect((error as Error).message).toContain("500");
  });

  it("identifies an unreadable file as a permission failure", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "Markdown file not readable",
            code: "permission-denied",
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
    );

    const error = await backend()
      .getMarkdownFile("notes/locked.md")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MarkdownFilePermissionError);
    expect(error).not.toBeInstanceOf(MarkdownFileNotFoundError);
    expect((error as MarkdownFilePermissionError).path).toBe("notes/locked.md");
  });
});
