import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type MarkdownTreeKind = "git" | "folder";

export interface MarkdownTreeFile {
  /** POSIX-style path relative to the listing root. */
  path: string;
  modifiedAt: number;
}

export interface MarkdownTreeListing {
  root: string;
  name: string;
  kind: MarkdownTreeKind;
  files: MarkdownTreeFile[];
  truncated: boolean;
}

export interface MarkdownTreeLimits {
  maxFiles: number;
  maxDirectories: number;
}

export const DEFAULT_MARKDOWN_TREE_LIMITS: MarkdownTreeLimits = {
  maxFiles: 5_000,
  maxDirectories: 20_000,
};

/**
 * Directories that hold dependencies, build output, caches or OS clutter.
 * Other dot-directories (for example `.context` or `.claude`) are walked on
 * purpose: people keep plans in gitignored dot-folders, so `.gitignore` is not
 * applied either.
 */
export const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  "target",
  "coverage",
  ".Trash",
  "Library",
]);

export type MarkdownTreeQueryResult =
  | { status: 200; listing: MarkdownTreeListing }
  | { status: 400 | 404; error: string };

export interface MarkdownTreeQuery {
  file?: unknown;
  root?: unknown;
}

function isMarkdownName(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

function isFilesystemRoot(dir: string): boolean {
  return path.parse(dir).root === dir;
}

/**
 * Finds the project a Markdown file belongs to: the nearest ancestor holding a
 * `.git` entry (a directory, or a file for worktrees and submodules). The home
 * directory and the filesystem root are never accepted as git roots. Without
 * a git root, the file's own directory is used.
 */
export async function resolveMarkdownProject(
  filePath: string,
  homeDir: string,
): Promise<{ root: string; kind: MarkdownTreeKind }> {
  const fileDir = path.dirname(path.resolve(filePath));
  const normalizedHome = path.resolve(homeDir);

  let current = fileDir;
  while (current !== normalizedHome && !isFilesystemRoot(current)) {
    if (await pathExists(path.join(current, ".git"))) {
      return { root: current, kind: "git" };
    }
    current = path.dirname(current);
  }

  return { root: fileDir, kind: "folder" };
}

async function readDirectoryEntries(dir: string): Promise<Dirent[] | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    // Unreadable or vanished directories (EACCES, EPERM, ENOENT races) are
    // left out rather than failing the whole listing.
    return null;
  }
}

async function modifiedAtOrNull(filePath: string): Promise<number | null> {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Lists the Markdown files under `root`, breadth first so that shallow files
 * survive truncation. Symlinks are skipped entirely, which also rules out
 * cycles.
 */
export async function listMarkdownTree(
  root: string,
  options: {
    kind: MarkdownTreeKind;
    recursive?: boolean;
    limits?: Partial<MarkdownTreeLimits>;
  },
): Promise<MarkdownTreeListing> {
  const resolvedRoot = path.resolve(root);
  const recursive = options.recursive ?? true;
  const maxFiles =
    options.limits?.maxFiles ?? DEFAULT_MARKDOWN_TREE_LIMITS.maxFiles;
  const maxDirectories =
    options.limits?.maxDirectories ??
    DEFAULT_MARKDOWN_TREE_LIMITS.maxDirectories;

  const files: MarkdownTreeFile[] = [];
  let truncated = false;
  let visitedDirectories = 0;
  const queue: string[] = [""];

  walk: while (queue.length > 0) {
    if (visitedDirectories >= maxDirectories) {
      truncated = true;
      break;
    }
    const relativeDir = queue.shift() as string;
    visitedDirectories += 1;

    const entries = await readDirectoryEntries(
      path.join(resolvedRoot, relativeDir),
    );
    if (!entries) continue;

    const markdownFiles: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;

      if (entry.isDirectory()) {
        if (recursive && !IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          queue.push(relativePath);
        }
      } else if (entry.isFile() && isMarkdownName(entry.name)) {
        markdownFiles.push(relativePath);
      }
    }

    const modifiedTimes = await Promise.all(
      markdownFiles.map((relativePath) =>
        modifiedAtOrNull(path.join(resolvedRoot, relativePath)),
      ),
    );
    for (const [index, relativePath] of markdownFiles.entries()) {
      const modifiedAt = modifiedTimes[index];
      if (modifiedAt === null || modifiedAt === undefined) continue;
      if (files.length >= maxFiles) {
        truncated = true;
        break walk;
      }
      files.push({ path: relativePath, modifiedAt });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    root: resolvedRoot,
    name: path.basename(resolvedRoot) || resolvedRoot,
    kind: options.kind,
    files,
    truncated,
  };
}

/** Lists the project containing `filePath` (see `resolveMarkdownProject`). */
export async function markdownTreeForFile(
  filePath: string,
  homeDir: string,
  limits?: Partial<MarkdownTreeLimits>,
): Promise<MarkdownTreeListing> {
  const { root, kind } = await resolveMarkdownProject(filePath, homeDir);
  // A loose file in the home directory or at the filesystem root lists only
  // its siblings, so the sidebar never walks the whole home directory.
  const recursive =
    kind === "git" ||
    (root !== path.resolve(homeDir) && !isFilesystemRoot(root));
  return listMarkdownTree(root, { kind, recursive, limits });
}

/** Lists a pinned folder. It counts as a git project only if it holds `.git`. */
export async function markdownTreeForRoot(
  root: string,
  limits?: Partial<MarkdownTreeLimits>,
): Promise<MarkdownTreeListing> {
  const resolvedRoot = path.resolve(root);
  const kind: MarkdownTreeKind = (await pathExists(
    path.join(resolvedRoot, ".git"),
  ))
    ? "git"
    : "folder";
  return listMarkdownTree(resolvedRoot, { kind, limits });
}

function queryValue(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return value.length > 0 ? value : undefined;
}

/**
 * Validates a `/api/markdown-tree` query (`file=` or `root=`, exactly one,
 * absolute) and produces the listing or an HTTP error.
 */
export async function markdownTreeFromQuery(
  query: MarkdownTreeQuery,
  homeDir: string,
  limits?: Partial<MarkdownTreeLimits>,
): Promise<MarkdownTreeQueryResult> {
  const file = queryValue(query.file);
  const root = queryValue(query.root);

  if (file === null || root === null) {
    return { status: 400, error: "file and root must be single values" };
  }
  if ((file === undefined) === (root === undefined)) {
    return { status: 400, error: "Provide exactly one of file or root" };
  }

  const requested = (file ?? root) as string;
  if (!path.isAbsolute(requested)) {
    return { status: 400, error: "Path must be absolute" };
  }

  if (file !== undefined) {
    if (!isMarkdownName(file) || !(await isFile(file))) {
      return { status: 404, error: "Markdown file not found" };
    }
    return {
      status: 200,
      listing: await markdownTreeForFile(file, homeDir, limits),
    };
  }

  if (!(await isDirectory(requested))) {
    return { status: 404, error: "Directory not found" };
  }
  return { status: 200, listing: await markdownTreeForRoot(requested, limits) };
}
