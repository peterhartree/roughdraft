import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareVersions, resolveUpdateStatus } from "./update-status";

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

describe("resolveUpdateStatus", () => {
  const tempPaths: string[] = [];

  afterEach(() => {
    tempPaths.forEach((tempPath) => {
      fs.rmSync(tempPath, { recursive: true, force: true });
    });
    tempPaths.length = 0;
  });

  it("reports when the installed version is behind npm", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-pkg-"));
    const packageJsonPath = path.join(tempDir, "package.json");
    tempPaths.push(tempDir);
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: "roughdraft", version: "0.1.0" }),
    );

    const status = await resolveUpdateStatus({
      packageJsonPath,
      fetchImpl: async () =>
        new Response(JSON.stringify({ version: "0.2.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    expect(status).toEqual({
      packageName: "roughdraft",
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      updateCommand: "npm i -g roughdraft@latest",
    });
  });

  it("degrades cleanly when npm cannot be reached", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-pkg-"));
    const packageJsonPath = path.join(tempDir, "package.json");
    tempPaths.push(tempDir);
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: "roughdraft", version: "0.1.0" }),
    );

    const status = await resolveUpdateStatus({
      packageJsonPath,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });

    expect(status).toEqual({
      packageName: "roughdraft",
      currentVersion: "0.1.0",
      latestVersion: null,
      updateAvailable: false,
      updateCommand: "npm i -g roughdraft@latest",
    });
  });

  it("asks the release source at most once per check interval", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-pkg-"));
    tempPaths.push(tempDir);
    const packageJsonPath = path.join(tempDir, "package.json");
    const cacheFile = path.join(tempDir, "state", "update-check.json");
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: "roughdraft", version: "0.1.0" }),
    );
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      return new Response(JSON.stringify({ version: "0.2.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const hour = 60 * 60 * 1000;
    const check = (now: number) =>
      resolveUpdateStatus({
        packageJsonPath,
        fetchImpl,
        cacheFile,
        now: () => now,
      });

    expect((await check(0)).latestVersion).toBe("0.2.0");
    expect((await check(11 * hour)).latestVersion).toBe("0.2.0");
    expect(requests).toBe(1);

    await check(13 * hour);
    expect(requests).toBe(2);
  });

  it("retries an unreachable source sooner than a reachable one", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-pkg-"));
    tempPaths.push(tempDir);
    const packageJsonPath = path.join(tempDir, "package.json");
    const cacheFile = path.join(tempDir, "update-check.json");
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: "roughdraft", version: "0.1.0" }),
    );
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
