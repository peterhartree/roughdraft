import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_START_TIMEOUT_MS = 60_000;

const SERVER_LOAD_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];

export function nextServerLoadRetryDelay(
  failedAttempts: number,
): number | null {
  if (failedAttempts < 1) return SERVER_LOAD_RETRY_DELAYS_MS[0];
  return SERVER_LOAD_RETRY_DELAYS_MS[failedAttempts - 1] ?? null;
}

function desktopPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): string {
  const pathEntries = [
    path.join(homeDir, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(env.PATH?.split(path.delimiter) ?? []),
  ];

  return [...new Set(pathEntries.filter(Boolean))].join(path.delimiter);
}

export function appendDesktopSlog(
  event: string,
  data: Record<string, unknown> = {},
): void {
  const file = process.env.THOUGHTFUL_SLOG_FILE;
  if (!file) return;

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(
      file,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        runId: process.env.THOUGHTFUL_SLOG_RUN_ID ?? "manual",
        source: "packages/desktop/src/startup.ts",
        event,
        data,
      })}\n`,
    );
  } catch {}
}

export function startManagedServer({
  env = process.env,
  homeDir = os.homedir(),
}: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}): Promise<void> {
  const childEnv = { ...env, PATH: desktopPath(env, homeDir) };
  appendDesktopSlog("desktop.server-start.requested", {
    command: "roughdraft",
  });

  return new Promise((resolve, reject) => {
    execFile(
      "roughdraft",
      ["start", "--json"],
      {
        cwd: homeDir,
        env: childEnv,
        timeout: SERVER_START_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, _stdout, stderr) => {
        if (!error) {
          appendDesktopSlog("desktop.server-start.succeeded");
          resolve();
          return;
        }

        const detail = stderr.trim() || error.message;
        appendDesktopSlog("desktop.server-start.failed", { detail });
        reject(
          new Error(`Could not start the managed Roughdraft server: ${detail}`),
        );
      },
    );
  });
}
