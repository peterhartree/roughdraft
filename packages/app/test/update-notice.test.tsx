import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateNotice } from "../src/UpdateNotice";
import type { UpdateStatus } from "../src/update-status";

const status: UpdateStatus = {
  packageName: "roughdraft",
  currentVersion: "0.2.0",
  latestVersion: "0.3.0",
  releaseUrl: "https://github.com/peterhartree/roughdraft/releases/tag/v0.3.0",
  updateAvailable: true,
  updateCommand: "roughdraft update",
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("UpdateNotice", () => {
  let container: HTMLDivElement;
  let root: Root;
  let progress: unknown;
  let startResponse: Response;
  let posts: number;

  beforeEach(() => {
    vi.useFakeTimers();
    progress = { state: "idle" };
    startResponse = json(
      { state: "running", message: "Starting the update…" },
      { status: 202 },
    );
    posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/update" && init?.method === "POST") {
          posts += 1;
          return startResponse;
        }
        if (url === "/api/update-progress") return json(progress);
        throw new Error(`Unexpected request to ${url}`);
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const testId = (id: string) =>
    container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  async function render() {
    await act(async () => {
      root.render(<UpdateNotice updateStatus={status} />);
    });
  }

  it("shows both versions and links to the release notes", async () => {
    await render();

    expect(container.textContent).toContain("Version 0.3.0 is out");
    expect(container.textContent).toContain("You have 0.2.0");
    expect(testId("update-notice-release-link")?.getAttribute("href")).toBe(
      status.releaseUrl,
    );
  });

  it("starts the update and shows its progress", async () => {
    await render();

    await act(async () => {
      testId("update-notice-button")?.click();
    });
    expect(posts).toBe(1);
    expect(testId("update-notice-button")).toHaveProperty("disabled", true);

    progress = {
      state: "running",
      step: "building",
      message: "Building Roughdraft…",
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(testId("update-notice-progress")?.textContent).toContain(
      "Building Roughdraft…",
    );
  });

  it("explains a failed update and offers to try again", async () => {
    await render();

    await act(async () => {
      testId("update-notice-button")?.click();
    });
    progress = {
      state: "failed",
      message:
        "The checkout has local changes. Commit or discard them and try again.",
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(testId("update-notice-error")?.textContent).toContain(
      "local changes",
    );
    expect(testId("update-notice-button")?.textContent).toBe("Try again");
  });

  it("keeps showing progress while the server is down to reinstall", async () => {
    await render();
    await act(async () => {
      testId("update-notice-button")?.click();
    });

    vi.mocked(fetch).mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(testId("update-notice-progress")).not.toBeNull();
  });
});
