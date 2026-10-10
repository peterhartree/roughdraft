import fs from "node:fs";
import path from "node:path";

/** A rename the user can fix by choosing another name. */
export class RenameRejectedError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

const MAX_FILE_NAME_BYTES = 255;

/**
 * Validates a new name for a Markdown file. The name stays in the file's own
 * folder, so separators are refused rather than treated as a move.
 */
export function validateMarkdownFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new RenameRejectedError("Enter a file name.", 400);
  if (/[/\\\0]/.test(trimmed)) {
    throw new RenameRejectedError("File names can't contain slashes.", 400);
  }
  if (!trimmed.toLowerCase().endsWith(".md") || trimmed.length <= 3) {
    throw new RenameRejectedError("File names must end in .md.", 400);
  }
  if (Buffer.byteLength(trimmed) > MAX_FILE_NAME_BYTES) {
    throw new RenameRejectedError("That file name is too long.", 400);
  }
  return trimmed;
}

function isSameFile(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Renames a Markdown file within its folder and returns the new absolute
 * path. Refuses to replace another file; a change of letter case alone is
 * allowed on case-insensitive volumes, where the target "exists" as the
 * source itself.
 */
export function renameMarkdownFile(absolutePath: string, name: string): string {
  const nextName = validateMarkdownFileName(name);

  let source: fs.Stats;
  try {
    source = fs.statSync(absolutePath);
  } catch {
    throw new RenameRejectedError("Markdown file not found", 404);
  }
  if (!source.isFile()) {
    throw new RenameRejectedError("Markdown file not found", 404);
  }

  const targetPath = path.join(path.dirname(absolutePath), nextName);
  if (targetPath === absolutePath) return absolutePath;

  let existing: fs.Stats | null = null;
  try {
    existing = fs.lstatSync(targetPath);
  } catch {
    existing = null;
  }
  if (existing && !isSameFile(existing, source)) {
    throw new RenameRejectedError(
      `A file named ${nextName} already exists in this folder.`,
      409,
    );
  }

  fs.renameSync(absolutePath, targetPath);
  return targetPath;
}
