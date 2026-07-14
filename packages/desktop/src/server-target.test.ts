import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readManagedServerTarget,
  isAllowedExternalUrl,
  isAllowedNavigation,
  resolveManagedServerStateFile,
  validateManagedServerTarget,
  verifyManagedServerTarget,
} from "./server-target.js";

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "roughdraft-desktop-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("managed server target validation", () => {
  it.each([
    "http://localhost:7373",
    "http://127.0.0.1:7373/",
    "http://[::1]:7373",
  ])("accepts a loopback Roughdraft server URL: %s", (url) => {
    expect(validateManagedServerTarget({ port: 7373, url })).toEqual({
      port: 7373,
      url: new URL(url).origin,
    });
  });

  it.each([
    "https://localhost:7373",
    "http://roughdraft.example:7373",
    "file:///tmp/roughdraft.html",
    "javascript:alert(1)",
    "http://user:pass@localhost:7373",
  ])("rejects a non-local or privileged target: %s", (url) => {
    expect(() => validateManagedServerTarget({ port: 7373, url })).toThrow();
  });

  it("rejects a state file whose URL port disagrees with its recorded port", () => {
    expect(() =>
      validateManagedServerTarget({ port: 7374, url: "http://localhost:7373" }),
    ).toThrow(/port/i);
  });

  it("resolves explicit state files before state directories and defaults", () => {
    expect(
      resolveManagedServerStateFile({
        env: {
          ROUGHDRAFT_STATE_DIR: "/tmp/ignored",
          ROUGHDRAFT_STATE_FILE: "/tmp/explicit.json",
        },
        homeDir: "/Users/example",
      }),
    ).toBe("/tmp/explicit.json");
    expect(
      resolveManagedServerStateFile({
        env: { ROUGHDRAFT_STATE_DIR: "/tmp/state" },
        homeDir: "/Users/example",
      }),
    ).toBe("/tmp/state/server.json");
    expect(
      resolveManagedServerStateFile({ env: {}, homeDir: "/Users/example" }),
    ).toBe("/Users/example/.roughdraft/server.json");
  });

  it("reads and validates a managed server state file", () => {
    const stateFile = path.join(makeTemporaryDirectory(), "server.json");
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ port: 7373, url: "http://localhost:7373" }),
    );

    expect(readManagedServerTarget(stateFile)).toEqual({
      port: 7373,
      url: "http://localhost:7373",
    });
  });

  it("verifies that the target is the expected Roughdraft backend", async () => {
    const target = { port: 7373, url: "http://localhost:7373" };
    await expect(
      verifyManagedServerTarget(target, async (input) => {
        expect(String(input)).toBe("http://localhost:7373/api/status");
        return new Response(
          JSON.stringify({ backend: "local-files", port: 7373 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    ).resolves.toEqual(target);
  });

  it("rejects stale or spoofed backend status", async () => {
    const target = { port: 7373, url: "http://localhost:7373" };
    await expect(
      verifyManagedServerTarget(
        target,
        async () =>
          new Response(JSON.stringify({ backend: "other", port: 7373 })),
      ),
    ).rejects.toThrow(/Roughdraft/i);
    await expect(
      verifyManagedServerTarget(
        target,
        async () =>
          new Response(JSON.stringify({ backend: "local-files", port: 7374 })),
      ),
    ).rejects.toThrow(/port/i);
  });

  it("keeps top-level navigation on the validated Roughdraft origin", () => {
    expect(
      isAllowedNavigation(
        "http://localhost:7373/?path=%2Ftmp%2Fa.md",
        "http://localhost:7373",
      ),
    ).toBe(true);
    expect(
      isAllowedNavigation(
        "https://example.com/phishing",
        "http://localhost:7373",
      ),
    ).toBe(false);
  });

  it("opens only ordinary web links outside the Electron renderer", () => {
    expect(isAllowedExternalUrl("https://example.com/docs")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com/docs")).toBe(true);
    expect(isAllowedExternalUrl("file:///Users/example/.ssh/id_rsa")).toBe(
      false,
    );
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
  });
});
