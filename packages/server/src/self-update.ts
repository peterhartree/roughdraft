import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Roughdraft is installed from a clone of the repository, so an update pulls
// the latest `main`, rebuilds, and replaces the installed app. Nothing is
// replaced until the build has succeeded, and the old version keeps working
// if any step fails.

export type UpdateStep =
  | "checking"
  | "pulling"
  | "installing"
  | "building"
  | "packaging"
  | "quitting"
  | "replacing"
  | "relaunching";

export interface UpdateProgress {
  state: "running" | "failed" | "done";
  step: UpdateStep | null;
  message: string;
  updatedAt: string;
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface SelfUpdateDependencies {
  repoRoot: string;
  platform: NodeJS.Platform;
  homeDir: string;
  run: (command: string, args: string[]) => CommandResult;
  exists: (filePath: string) => boolean;
  sleep: (ms: number) => Promise<void>;
  report: (progress: UpdateProgress) => void;
  log: (line: string) => void;
  /** Leave the freshly installed app closed (used by tests and dry runs). */
  relaunch?: boolean;
  quitTimeoutMs?: number;
}

const DESKTOP_APP_NAME = "Roughdraft.app";
const PACKAGED_APP = path.join(
  "packages",
  "desktop",
  "out",
  "Roughdraft-darwin-arm64",
  DESKTOP_APP_NAME,
);
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export class SelfUpdateError extends Error {}

export function installedAppPath(
  homeDir: string,
  exists: (filePath: string) => boolean,
): string {
  const candidates = [
    path.join(homeDir, "Applications", DESKTOP_APP_NAME),
    path.join("/Applications", DESKTOP_APP_NAME),
  ];
  return candidates.find((candidate) => exists(candidate)) ?? candidates[0];
}

function commandOutput(result: CommandResult): string {
  return `${result.stdout}${result.stderr}`.trim();
}

export async function runSelfUpdate(
  deps: SelfUpdateDependencies,
): Promise<"updated" | "current"> {
  const step = (current: UpdateStep, message: string) => {
    deps.log(message);
    deps.report({
      state: "running",
      step: current,
      message,
      updatedAt: new Date().toISOString(),
    });
  };
  const git = (args: string[]) =>
    deps.run("git", ["-C", deps.repoRoot, ...args]);
  const must = (result: CommandResult, failure: string) => {
    if (result.status !== 0) {
      const detail = commandOutput(result).split("\n").slice(-12).join("\n");
      throw new SelfUpdateError(detail ? `${failure}\n${detail}` : failure);
    }
    return result.stdout.trim();
  };

  if (deps.platform !== "darwin") {
    throw new SelfUpdateError("Roughdraft updates itself only on macOS.");
  }

  step("checking", "Checking the Roughdraft checkout…");
  const branch = must(
    git(["rev-parse", "--abbrev-ref", "HEAD"]),
    `${deps.repoRoot} is not a git checkout.`,
  );
  if (branch !== "main") {
    throw new SelfUpdateError(
      `The checkout at ${deps.repoRoot} is on ${branch}, not main. Switch back to main and try again.`,
    );
  }
  const changes = must(
    git(["status", "--porcelain", "--untracked-files=no"]),
    "Couldn't read the checkout's status.",
  );
  if (changes) {
    throw new SelfUpdateError(
      `The checkout at ${deps.repoRoot} has local changes. Commit or discard them and try again.`,
    );
  }

  step("pulling", "Downloading the latest version…");
  must(
    git(["fetch", "--quiet", "origin", "main"]),
    "Couldn't reach GitHub to download the update.",
  );
  const behind = Number(
    must(
      git(["rev-list", "--count", "HEAD..origin/main"]),
      "Couldn't compare the checkout with GitHub.",
    ),
  );
  if (behind === 0) {
    deps.log("Roughdraft is already up to date.");
    deps.report({
      state: "done",
      step: null,
      message: "Roughdraft is already up to date.",
      updatedAt: new Date().toISOString(),
    });
    return "current";
  }
  must(
    git(["merge", "--ff-only", "--quiet", "origin/main"]),
    "The checkout has commits that aren't on GitHub, so it can't move to the latest version.",
  );

  const pnpm = (args: string[]) =>
    deps.run("pnpm", ["--dir", deps.repoRoot, ...args]);
  step("installing", "Installing dependencies…");
  must(
    pnpm(["install", "--frozen-lockfile"]),
    "Installing dependencies failed.",
  );
  step("building", "Building Roughdraft…");
  must(pnpm(["build"]), "The build failed.");
  step("packaging", "Packaging the app…");
  must(
    pnpm(["--filter", "@roughdraft/desktop", "package"]),
    "Packaging the app failed.",
  );

  const appPath = installedAppPath(deps.homeDir, deps.exists);
  const appExecutable = path.join(appPath, "Contents", "MacOS", "Roughdraft");
  const appRunning = () =>
    deps.run("pgrep", ["-f", appExecutable]).status === 0;

  step("quitting", "Closing Roughdraft…");
  // Asking an app that isn't running to quit would launch it first.
  if (appRunning()) {
    deps.run("osascript", ["-e", 'tell application "Roughdraft" to quit']);
  }
  const quitTimeoutMs = deps.quitTimeoutMs ?? 60_000;
  for (let waited = 0; appRunning(); waited += 500) {
    if (waited >= quitTimeoutMs) {
      throw new SelfUpdateError(
        "Roughdraft didn't close, probably because a document has unsaved changes. Save it and try again.",
      );
    }
    await deps.sleep(500);
  }
  // The new app starts a server from the new build; this one is stale.
  deps.run(process.execPath, [
    path.join(deps.repoRoot, "packages", "server", "bin", "roughdraft.mjs"),
    "stop",
  ]);

  step("replacing", "Installing the new version…");
  deps.run("mkdir", ["-p", path.dirname(appPath)]);
  must(
    deps.run("ditto", [path.join(deps.repoRoot, PACKAGED_APP), appPath]),
    `Couldn't replace ${appPath}.`,
  );
  deps.run("touch", [appPath]);
  deps.run(LSREGISTER, ["-f", appPath]);

  if (deps.relaunch !== false) {
    step("relaunching", "Reopening Roughdraft…");
    must(deps.run("open", [appPath]), `Couldn't open ${appPath}.`);
  }

  deps.log("Roughdraft is up to date.");
  deps.report({
    state: "done",
    step: null,
    message: "Roughdraft is up to date.",
    updatedAt: new Date().toISOString(),
  });
  return "updated";
}

export function defaultUpdateProgressFile(homeDir: string): string {
  return path.join(homeDir, ".roughdraft", "update-progress.json");
}

export function defaultUpdateLogFile(homeDir: string): string {
  return path.join(homeDir, ".roughdraft", "update.log");
}

export function readUpdateProgress(
  progressFile: string,
): UpdateProgress | null {
  try {
    const progress = JSON.parse(
      fs.readFileSync(progressFile, "utf8"),
    ) as UpdateProgress;
    return typeof progress.state === "string" ? progress : null;
  } catch {
    return null;
  }
}

export function writeUpdateProgress(
  progressFile: string,
  progress: UpdateProgress,
): void {
  try {
    fs.mkdirSync(path.dirname(progressFile), { recursive: true });
    fs.writeFileSync(progressFile, `${JSON.stringify(progress)}\n`);
  } catch {}
}

/**
 * Node and pnpm often live outside the minimal PATH an app-launched server
 * inherits, so put Node's own directory and the usual install places first.
 */
export function updatePath(env: NodeJS.ProcessEnv): string {
  return [
    path.dirname(process.execPath),
    path.join(os.homedir(), "Library", "pnpm"),
    path.join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(env.PATH?.split(path.delimiter) ?? []),
  ]
    .filter(Boolean)
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
    .join(path.delimiter);
}

export function createSelfUpdateDependencies(options: {
  repoRoot: string;
  progressFile: string;
  log: (line: string) => void;
  relaunch?: boolean;
}): SelfUpdateDependencies {
  const env = { ...process.env, PATH: updatePath(process.env) };
  return {
    repoRoot: options.repoRoot,
    platform: process.platform,
    homeDir: os.homedir(),
    run: (command, args) => {
      const result = spawnSync(command, args, {
        cwd: options.repoRoot,
        env,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      return {
        status: result.error ? null : result.status,
        stdout: result.stdout ?? "",
        stderr: result.error ? String(result.error) : (result.stderr ?? ""),
      };
    },
    exists: (filePath) => fs.existsSync(filePath),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    report: (progress) => writeUpdateProgress(options.progressFile, progress),
    log: options.log,
    relaunch: options.relaunch,
  };
}
