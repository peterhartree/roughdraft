import { describe, expect, it } from "vitest";
import {
  type CommandResult,
  runSelfUpdate,
  type SelfUpdateDependencies,
  type UpdateProgress,
} from "./self-update";

const ok = (stdout = ""): CommandResult => ({ status: 0, stdout, stderr: "" });
const fail = (stderr: string): CommandResult => ({
  status: 1,
  stdout: "",
  stderr,
});

interface FakeMac {
  branch?: string;
  changes?: string;
  behind?: number;
  build?: CommandResult;
  /** How many checks the app stays running for after being asked to quit. */
  quitAfterChecks?: number;
}

function fakeMac(mac: FakeMac = {}) {
  const commands: string[] = [];
  const reports: UpdateProgress[] = [];
  let quitRequested = false;
  let runningChecks = 0;
  const deps: SelfUpdateDependencies = {
    repoRoot: "/repo",
    platform: "darwin",
    homeDir: "/Users/pablo",
    exists: (filePath) =>
      filePath === "/Users/pablo/Applications/Roughdraft.app",
    sleep: async () => {},
    report: (progress) => reports.push(progress),
    log: () => {},
    quitTimeoutMs: 2_000,
    run: (command, args) => {
      const line = [command, ...args].join(" ");
      commands.push(line);
      if (line.includes("rev-parse --abbrev-ref HEAD"))
        return ok(`${mac.branch ?? "main"}\n`);
      if (line.includes("status --porcelain")) return ok(mac.changes ?? "");
      if (line.includes("rev-list --count")) return ok(`${mac.behind ?? 3}\n`);
      if (line.endsWith(" build")) return mac.build ?? ok();
      if (command === "osascript") {
        quitRequested = true;
        return ok();
      }
      if (command === "pgrep") {
        if (!quitRequested) return ok("123");
        runningChecks += 1;
        return runningChecks <= (mac.quitAfterChecks ?? 0)
          ? ok("123")
          : fail("");
      }
      return ok();
    },
  };
  return { deps, commands, reports };
}

function index(commands: string[], fragment: string): number {
  const found = commands.findIndex((line) => line.includes(fragment));
  if (found === -1) throw new Error(`No command containing "${fragment}"`);
  return found;
}

describe("runSelfUpdate", () => {
  it("builds the new version before touching the installed app", async () => {
    const { deps, commands, reports } = fakeMac();

    await expect(runSelfUpdate(deps)).resolves.toBe("updated");

    const order = [
      "merge --ff-only",
      "install --frozen-lockfile",
      " build",
      "@roughdraft/desktop package",
      "osascript",
      "roughdraft.mjs stop",
      "ditto",
      "open /Users/pablo/Applications/Roughdraft.app",
    ].map((fragment) => index(commands, fragment));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(reports.at(-1)?.state).toBe("done");
  });

  it("does nothing when the checkout already has the latest version", async () => {
    const { deps, commands } = fakeMac({ behind: 0 });

    await expect(runSelfUpdate(deps)).resolves.toBe("current");
    expect(commands.some((line) => line.includes("merge"))).toBe(false);
    expect(commands.some((line) => line.startsWith("ditto"))).toBe(false);
  });

  it("refuses a checkout with local changes", async () => {
    const { deps, commands } = fakeMac({ changes: " M README.md\n" });

    await expect(runSelfUpdate(deps)).rejects.toThrow(/local changes/);
    expect(commands.some((line) => line.includes("fetch"))).toBe(false);
  });

  it("refuses a checkout that isn't on main", async () => {
    const { deps } = fakeMac({ branch: "experiment" });

    await expect(runSelfUpdate(deps)).rejects.toThrow(/on experiment/);
  });

  it("keeps the installed app when the build fails", async () => {
    const { deps, commands } = fakeMac({ build: fail("tsc: error") });

    await expect(runSelfUpdate(deps)).rejects.toThrow(/build failed[\s\S]*tsc/);
    expect(commands.some((line) => line.startsWith("osascript"))).toBe(false);
    expect(commands.some((line) => line.startsWith("ditto"))).toBe(false);
  });

  it("stops before replacing the app if it won't close", async () => {
    const { deps, commands } = fakeMac({ quitAfterChecks: 100 });

    await expect(runSelfUpdate(deps)).rejects.toThrow(/unsaved changes/);
    expect(commands.some((line) => line.startsWith("ditto"))).toBe(false);
  });
});
