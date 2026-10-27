import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareVersions,
  gitHubRepository,
  resolveUpdateStatus,
} from "./update-status";

describe("compareVersions", () => {
  it("orders numeric versions correctly", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("1.4.0", "1.4.0")).toBe(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("treats prereleases as older than stable releases", () => {
    expect(compareVersions("0.2.0-beta.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0-beta.2", "0.2.0-beta.1")).toBeGreaterThan(0);
  });
});

function release(tag: string) {
  return async () =>
    new Response(
      JSON.stringify({
        tag_name: tag,
        html_url: `https://github.com/peterhartree/roughdraft/releases/tag/${tag}`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
}

describe("gitHubRepository", () => {
  it("reads owner and name from the usual repository URLs", () => {
    expect(
      gitHubRepository("git+https://github.com/peterhartree/roughdraft.git"),
    ).toBe("peterhartree/roughdraft");
    expect(gitHubRepository("git@github.com:peterhartree/roughdraft.git")).toBe(
      "peterhartree/roughdraft",
    );
    expect(gitHubRepository("https://gitlab.com/a/b")).toBeNull();
  });
});

describe("resolveUpdateStatus", () => {
  const tempPaths: string[] = [];

  afterEach(() => {
    tempPaths.forEach((tempPath) => {
      fs.rmSync(tempPath, { recursive: true, force: true });
    });
    tempPaths.length = 0;
  });

  function installedPackage(version: string) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-pkg-"));
    tempPaths.push(tempDir);
    const packageJsonPath = path.join(tempDir, "package.json");
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({
        name: "roughdraft",
        version,
        repository: {
          type: "git",
          url: "git+https://github.com/peterhartree/roughdraft.git",
        },
      }),
    );
    return { tempDir, packageJsonPath };
  }

  it("reports a newer release of the fork, with its notes", async () => {
    const { packageJsonPath } = installedPackage("0.2.0");
    const requested: string[] = [];

    const status = await resolveUpdateStatus({
      packageJsonPath,
      fetchImpl: async (url) => {
        requested.push(String(url));
        return release("v0.2.1")();
      },
    });

    expect(requested).toEqual([
      "https://api.github.com/repos/peterhartree/roughdraft/releases/latest",
    ]);
    expect(status).toEqual({
      packageName: "roughdraft",
      currentVersion: "0.2.0",
      latestVersion: "0.2.1",
      releaseUrl:
        "https://github.com/peterhartree/roughdraft/releases/tag/v0.2.1",
      updateAvailable: true,
      updateCommand: "roughdraft update",
    });
  });

  it("reports nothing when the installed version is current", async () => {
    const { packageJsonPath } = installedPackage("0.2.1");

    const status = await resolveUpdateStatus({
      packageJsonPath,
      fetchImpl: release("v0.2.1"),
    });

    expect(status.updateAvailable).toBe(false);
  });

  it("degrades cleanly when GitHub cannot be reached", async () => {
    const { packageJsonPath } = installedPackage("0.2.0");

    const status = await resolveUpdateStatus({
      packageJsonPath,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });

    expect(status).toMatchObject({
      latestVersion: null,
      releaseUrl: null,
      updateAvailable: false,
    });
  });

  it("asks GitHub at most once per check interval", async () => {
    const { tempDir, packageJsonPath } = installedPackage("0.2.0");
    const cacheFile = path.join(tempDir, "state", "update-check.json");
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      return release("v0.2.1")();
    };
    const hour = 60 * 60 * 1000;
    const check = (now: number) =>
      resolveUpdateStatus({
        packageJsonPath,
        fetchImpl,
        cacheFile,
        now: () => now,
      });

    expect((await check(0)).latestVersion).toBe("0.2.1");
    expect((await check(11 * hour)).releaseUrl).toContain("v0.2.1");
    expect(requests).toBe(1);

    await check(13 * hour);
    expect(requests).toBe(2);
  });

  it("retries an unreachable source sooner than a reachable one", async () => {
    const { tempDir, packageJsonPath } = installedPackage("0.2.0");
    const cacheFile = path.join(tempDir, "update-check.json");
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      throw new Error("offline");
    };
    const minute = 60 * 1000;
    const check = (now: number) =>
      resolveUpdateStatus({
        packageJsonPath,
        fetchImpl,
        cacheFile,
        now: () => now,
      });

    await check(0);
    await check(30 * minute);
    expect(requests).toBe(1);

    await check(61 * minute);
    expect(requests).toBe(2);
  });
});
