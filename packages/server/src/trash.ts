import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type TrashCommandRunner = (
  command: string,
  args: string[],
) => Promise<void>;

export interface MoveToTrashDeps {
  platform?: NodeJS.Platform;
  run?: TrashCommandRunner;
  /** Checks whether a helper binary such as `/usr/bin/trash` is present. */
  exists?: (candidate: string) => boolean;
}

/** macOS 14 and later ship a `trash` command that uses Finder's semantics. */
export const MACOS_TRASH_BINARY = "/usr/bin/trash";

export const UNSUPPORTED_PLATFORM_MESSAGE =
  "Moving files to the Trash isn't supported on this platform.";

/**
 * Finder script for macOS versions without `/usr/bin/trash`. The path arrives
 * as an argv item so that quotes or backslashes in a file name can never
 * change the script itself.
 */
export const OSASCRIPT_TRASH_ARGS: readonly string[] = [
  "-e",
  "on run argv",
  "-e",
  'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
  "-e",
  "end run",
];

export const defaultTrashCommandRunner: TrashCommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, (error, _stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      const detail = String(stderr ?? "").trim();
      reject(new Error(detail || error.message));
    });
  });

function pathExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function trashCommand(
  filePath: string,
  platform: NodeJS.Platform,
  exists: (candidate: string) => boolean,
): { command: string; args: string[] } {
  if (platform === "darwin") {
    if (exists(MACOS_TRASH_BINARY)) {
      return { command: MACOS_TRASH_BINARY, args: [filePath] };
    }
    return {
      command: "osascript",
      args: [...OSASCRIPT_TRASH_ARGS, filePath],
    };
  }
  if (platform === "linux") {
    return { command: "gio", args: ["trash", filePath] };
  }
  throw new Error(UNSUPPORTED_PLATFORM_MESSAGE);
}

/**
 * Moves a file to the OS Trash so the user can restore it, rather than
 * deleting it permanently.
 */
export async function moveToTrash(
  filePath: string,
  deps: MoveToTrashDeps = {},
): Promise<void> {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? defaultTrashCommandRunner;
  const exists = deps.exists ?? pathExists;
  const { command, args } = trashCommand(filePath, platform, exists);
  const name = path.basename(filePath);

  try {
    await run(command, args);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Couldn't move ${name} to the Trash: ${detail}`);
  }

  // Some tools exit 0 without moving anything, so confirm the file has gone.
  if (pathExists(filePath)) {
    throw new Error(
      `Couldn't move ${name} to the Trash: the file is still in place.`,
    );
  }
}
