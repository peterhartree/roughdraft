import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface GitHubRepo {
  owner: string;
  repo: string;
}

export interface GitRunOptions {
  timeoutMs?: number;
}

/**
 * Runs `git` with the given arguments in `cwd`. Resolves to trimmed stdout and
 * rejects with a {@link GitCommandError} when git exits non-zero.
 */
export type GitRunner = (
  args: string[],
  cwd: string,
  options?: GitRunOptions,
) => Promise<string>;

const GITHUB_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "www.github.com",
  "ssh.github.com",
]);
const REMOTE_PROTOCOLS: ReadonlySet<string> = new Set([
  "https:",
  "http:",
  "ssh:",
  "git:",
  "git+ssh:",
]);
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
// scp-like syntax: `[user@]host:owner/repo`. The path must not start with a
// slash, which tells it apart from `scheme://` URLs.
const SCP_LIKE_REMOTE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/;

export const GIT_TIMEOUT_MS = 2000;
/** Commits run hooks and pushes cross the network, so they get longer. */
export const GIT_WRITE_TIMEOUT_MS = 60_000;
/**
 * How long a folder's repository root and a repository's GitHub remote are
 * reused. Both change rarely; the branch and the file's state are read fresh
 * on every request.
 */
export const GITHUB_REPO_CACHE_TTL_MS = 5 * 60_000;

function repoFromPath(host: string, repoPath: string): GitHubRepo | null {
  if (!GITHUB_HOSTS.has(host.toLowerCase())) return null;
  const segments = repoPath
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .split("/");
  if (segments.length !== 2) return null;
  const [owner, repo] = segments;
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) return null;
  if (repo === "." || repo === "..") return null;
  return { owner, repo };
}

/**
 * Reads the owner and repository from a GitHub remote URL in any of git's
 * forms. Only the owner and repository are kept, so credentials embedded in
 * an https remote never leave this function.
 */
export function parseGitHubRemoteUrl(remote: string): GitHubRepo | null {
  const trimmed = remote.trim();
  const scpLike = SCP_LIKE_REMOTE.exec(trimmed);
  if (scpLike) return repoFromPath(scpLike[1], scpLike[2]);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!REMOTE_PROTOCOLS.has(url.protocol)) return null;
  return repoFromPath(url.hostname, url.pathname);
}

function encodeSegments(segments: readonly string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

export function buildGitHubBlobUrl(
  { owner, repo }: GitHubRepo,
  ref: string,
  repoRelativeSegments: readonly string[],
): string {
  return `https://github.com/${encodeSegments([owner, repo])}/blob/${encodeSegments(
    ref.split("/"),
  )}/${encodeSegments(repoRelativeSegments)}`;
}

/**
 * Git honours these variables over the working directory, so a server
 * launched from inside a git hook would otherwise answer for the wrong repo.
 */
const REPO_SELECTING_GIT_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
];

export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly timedOut: boolean,
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

export const defaultGitRunner: GitRunner = (args, cwd, options = {}) =>
  new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
    };
    for (const name of REPO_SELECTING_GIT_ENV) delete env[name];
    execFile(
      "git",
      args,
      {
        cwd,
        env,
        timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr ?? "").trim();
          reject(
            new GitCommandError(
              detail || error.message,
              detail,
              error.killed === true,
            ),
          );
          return;
        }
        resolve(String(stdout).trim());
      },
    );
  });

async function gitOrNull(
  runGit: GitRunner,
  args: string[],
  cwd: string,
): Promise<string | null> {
  try {
    const output = await runGit(args, cwd);
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

async function gitSucceeds(
  runGit: GitRunner,
  args: string[],
  cwd: string,
): Promise<boolean> {
  try {
    await runGit(args, cwd);
    return true;
  } catch {
    return false;
  }
}

/** A pathspec that matches this one path, whatever characters it contains. */
function literalPathspec(repoRelativePath: string): string {
  return `:(literal)${repoRelativePath}`;
}

/**
 * - `synced`: GitHub has this file exactly as it is on disk.
 * - `changed`: GitHub has the file, but an older version of it.
 * - `not-pushed`: the link would 404, because GitHub lacks the file or branch.
 * - `ignored`: git ignores the file, so it can never reach GitHub.
 * - `unknown`: HEAD is detached, so there is no branch to compare against.
 *
 * Comparisons use origin's remote-tracking branch as of the last fetch;
 * Roughdraft never fetches.
 */
export type GitHubSyncState =
  | "synced"
  | "changed"
  | "not-pushed"
  | "ignored"
  | "unknown";

export type GitHubSyncReason =
  /** `changed`: there are edits that are not committed. */
  | "uncommitted"
  /** `changed` or `not-pushed`: committed, but the commit is not on origin. */
  | "unpushed"
  /** `not-pushed`: git does not track the file yet. */
  | "untracked"
  /** `not-pushed`: origin has no copy of the branch. */
  | "branch-not-pushed";

export interface GitHubFileStatus {
  url: string;
  sync: GitHubSyncState;
  reason: GitHubSyncReason | null;
  /** The checked-out branch, or null when HEAD is detached. */
  branch: string | null;
  /**
   * Commits on the branch that origin's copy of it lacks, as of the last
   * fetch. Zero when origin has no copy of the branch.
   */
  ahead: number;
  /** Whether the file has changes that are not committed. */
  uncommitted: boolean;
}

interface WorkingTreeStatus {
  commit: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  entry: "changed" | "untracked" | "ignored" | null;
}

/** Reads `git status --porcelain=v2 --branch` output for a single path. */
export function parsePorcelainV2Status(output: string): WorkingTreeStatus {
  const status: WorkingTreeStatus = {
    commit: null,
    branch: null,
    upstream: null,
    ahead: 0,
    entry: null,
  };
  for (const line of output.split("\n")) {
    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice("# branch.oid ".length);
      status.commit = oid === "(initial)" ? null : oid;
    } else if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length);
      status.branch = head === "(detached)" ? null : head;
    } else if (line.startsWith("# branch.upstream ")) {
      status.upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const match = /^\+(\d+) -\d+$/.exec(line.slice("# branch.ab ".length));
      status.ahead = match ? Number(match[1]) : 0;
    } else if (line.startsWith("! ")) {
      status.entry = "ignored";
    } else if (line.startsWith("? ")) {
      status.entry ??= "untracked";
    } else if (/^[12u] /.test(line)) {
      status.entry ??= "changed";
    }
  }
  return status;
}

interface FileContext {
  root: string;
  repo: GitHubRepo;
  /** POSIX-style path relative to the repository root. */
  relativePath: string;
}

interface FileState {
  status: GitHubFileStatus;
  /** The branch name on origin, when HEAD is on a branch. */
  remoteBranch: string | null;
  /** Whether the branch already has an upstream of its own. */
  hasUpstream: boolean;
}

/**
 * The branch to link to and compare against: the checked-out branch, under
 * its origin name when it tracks one.
 */
function remoteBranchFor(tree: WorkingTreeStatus): string | null {
  if (!tree.branch) return null;
  return tree.upstream?.startsWith("origin/")
    ? tree.upstream.slice("origin/".length)
    : tree.branch;
}

async function lookUpFileState(
  runGit: GitRunner,
  { root, repo, relativePath }: FileContext,
): Promise<FileState | null> {
  const pathspec = literalPathspec(relativePath);
  const output = await gitOrNull(
    runGit,
    [
      "-c",
      "core.fsmonitor=false",
      "status",
      "--porcelain=v2",
      "--branch",
      "--ignored=matching",
      "--untracked-files=all",
      "--",
      pathspec,
    ],
    root,
  );
  if (!output) return null;
  const tree = parsePorcelainV2Status(output);
  const uncommitted = tree.entry === "changed" || tree.entry === "untracked";
  const segments = relativePath.split("/");

  const remoteBranch = remoteBranchFor(tree);
  if (!remoteBranch) {
    // Detached HEAD: link to origin's default branch, else the commit.
    const originHead = await gitOrNull(
      runGit,
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      root,
    );
    const ref = originHead?.startsWith("origin/")
      ? originHead.slice("origin/".length)
      : tree.commit;
    if (!ref) return null;
    return {
      status: {
        url: buildGitHubBlobUrl(repo, ref, segments),
        sync: tree.entry === "ignored" ? "ignored" : "unknown",
        reason: null,
        branch: null,
        ahead: 0,
        uncommitted,
      },
      remoteBranch: null,
      hasUpstream: false,
    };
  }

  const state = (
    sync: GitHubSyncState,
    reason: GitHubSyncReason | null,
    ahead: number,
  ): FileState => ({
    status: {
      url: buildGitHubBlobUrl(repo, remoteBranch, segments),
      sync,
      reason,
      branch: tree.branch,
      ahead,
      uncommitted,
    },
    remoteBranch,
    hasUpstream: tree.upstream !== null,
  });

  const trackingRef = `refs/remotes/origin/${remoteBranch}`;
  const trackingExists = await gitSucceeds(
    runGit,
    ["rev-parse", "--verify", "--quiet", `${trackingRef}^{commit}`],
    root,
  );
  let ahead = tree.ahead;
  if (trackingExists && !tree.upstream?.startsWith("origin/")) {
    const count = await gitOrNull(
      runGit,
      ["rev-list", "--count", `${trackingRef}..HEAD`],
      root,
    );
    ahead = Number(count ?? 0) || 0;
  }

  if (tree.entry === "ignored") return state("ignored", null, ahead);
  if (!trackingExists) return state("not-pushed", "branch-not-pushed", ahead);

  const onOrigin = await gitSucceeds(
    runGit,
    ["cat-file", "-e", `${trackingRef}:${relativePath}`],
    root,
  );
  if (!onOrigin) {
    return state(
      "not-pushed",
      tree.entry === "untracked" ? "untracked" : "unpushed",
      ahead,
    );
  }
  if (uncommitted) return state("changed", "uncommitted", ahead);
  if (ahead > 0) {
    const sameAsOrigin = await gitSucceeds(
      runGit,
      ["diff", "--quiet", trackingRef, "HEAD", "--", pathspec],
      root,
    );
    if (!sameAsOrigin) return state("changed", "unpushed", ahead);
  }
  return state("synced", null, ahead);
}

/** A cache whose entries expire, holding promises so lookups in flight are shared. */
function expiringCache<T>(now: () => number, ttlMs: number) {
  const entries = new Map<string, { expiresAt: number; value: Promise<T> }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    const value = load();
    entries.set(key, { expiresAt: now() + ttlMs, value });
    return value;
  };
}

/** Removes `user:password@` from any URL git echoes back in an error. */
function redactCredentials(message: string): string {
  return message.replace(/(\/\/)[^/@\s]+@/g, "$1");
}

function lastLine(message: string): string {
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? message).replace(/^(?:error|fatal): /, "");
}

function describePushFailure(error: unknown): string {
  if (error instanceof GitCommandError && error.timedOut) {
    return "The push to GitHub timed out.";
  }
  const message = redactCredentials(
    error instanceof Error ? error.message : String(error),
  );
  if (/\[rejected\]|non-fast-forward|fetch first/.test(message)) {
    return "GitHub has commits that this copy doesn't. Pull them, then push again.";
  }
  if (
    /Permission denied|Authentication failed|could not read Username|terminal prompts disabled|Host key verification failed/i.test(
      message,
    )
  ) {
    return "Git couldn't sign in to GitHub. Try pushing once from a terminal to check your credentials.";
  }
  return lastLine(message);
}

export class GitHubPushError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fileStatus: GitHubFileStatus | null = null,
  ) {
    super(message);
    this.name = "GitHubPushError";
  }
}

export interface GitHubFilesOptions {
  runGit?: GitRunner;
  now?: () => number;
  ttlMs?: number;
}

/**
 * GitHub links, sync state and commit-and-push for local files. Repository
 * roots are cached per folder and GitHub remotes per repository; the branch
 * and the file's own state are read fresh each time, because they change
 * whenever the file is saved, committed or pushed.
 */
export function createGitHubFiles({
  runGit = defaultGitRunner,
  now = Date.now,
  ttlMs = GITHUB_REPO_CACHE_TTL_MS,
}: GitHubFilesOptions = {}) {
  const rootForDirectory = expiringCache<string | null>(now, ttlMs);
  const repoForRoot = expiringCache<GitHubRepo | null>(now, ttlMs);
  const pushesInFlight = new Set<string>();

  async function fileContext(filePath: string): Promise<FileContext | null> {
    // Resolve symlinks first: git reports the physical repository root, and
    // the link should point at the file the symlink leads to.
    const realPath = await fs.realpath(filePath).catch(() => null);
    if (!realPath) return null;

    const directory = path.dirname(realPath);
    const root = await rootForDirectory(directory, async () => {
      const topLevel = await gitOrNull(
        runGit,
        ["rev-parse", "--show-toplevel"],
        directory,
      );
      return topLevel ? fs.realpath(topLevel).catch(() => null) : null;
    });
    if (!root) return null;
    const repo = await repoForRoot(root, async () => {
      const remote = await gitOrNull(
        runGit,
        ["remote", "get-url", "origin"],
        root,
      );
      return remote ? parseGitHubRemoteUrl(remote) : null;
    });
    if (!repo) return null;

    const relativePath = path.relative(root, realPath);
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return null;
    }
    return {
      root,
      repo,
      relativePath: relativePath.split(path.sep).join("/"),
    };
  }

  /** The file's GitHub link and sync state, or null when it has no GitHub home. */
  async function status(filePath: string): Promise<GitHubFileStatus | null> {
    const context = await fileContext(filePath);
    if (!context) return null;
    return (await lookUpFileState(runGit, context))?.status ?? null;
  }

  /**
   * Commits this file's changes alone, with nothing else that is staged, and
   * pushes the branch to origin. Never pulls, merges or force-pushes.
   */
  async function commitAndPush(filePath: string): Promise<GitHubFileStatus> {
    const context = await fileContext(filePath);
    if (!context) {
      throw new GitHubPushError(
        "This file isn't in a repository whose origin is on GitHub.",
        409,
      );
    }
    if (pushesInFlight.has(context.root)) {
      throw new GitHubPushError(
        "A push for this repository is already running.",
        409,
      );
    }
    pushesInFlight.add(context.root);
    try {
      const before = await lookUpFileState(runGit, context);
      if (!before) {
        throw new GitHubPushError("Couldn't read this file's git status.", 500);
      }
      if (!before.remoteBranch) {
        throw new GitHubPushError(
          "Check out a branch before pushing.",
          409,
          before.status,
        );
      }
      if (before.status.sync === "ignored") {
        throw new GitHubPushError(
          "Git ignores this file, so it can't be pushed.",
          409,
          before.status,
        );
      }

      const pathspec = literalPathspec(context.relativePath);
      let committed = false;
      if (before.status.uncommitted) {
        try {
          await runGit(["add", "--", pathspec], context.root);
          await runGit(
            [
              "commit",
              "--quiet",
              "--only",
              "-m",
              `docs: update ${context.relativePath}`,
              "--",
              pathspec,
            ],
            context.root,
            { timeoutMs: GIT_WRITE_TIMEOUT_MS },
          );
          committed = true;
        } catch (error) {
          const detail = lastLine(
            redactCredentials(
              error instanceof Error ? error.message : String(error),
            ),
          );
          throw new GitHubPushError(
            `Couldn't commit: ${detail}`,
            500,
            (await lookUpFileState(runGit, context))?.status ?? null,
          );
        }
      }

      if (committed || before.status.sync !== "synced") {
        try {
          await runGit(
            [
              "push",
              ...(before.hasUpstream ? [] : ["--set-upstream"]),
              "origin",
              `HEAD:refs/heads/${before.remoteBranch}`,
            ],
            context.root,
            { timeoutMs: GIT_WRITE_TIMEOUT_MS },
          );
        } catch (error) {
          const reason = describePushFailure(error);
          throw new GitHubPushError(
            committed ? `Committed, but the push failed. ${reason}` : reason,
            502,
            (await lookUpFileState(runGit, context))?.status ?? null,
          );
        }
      }

      const after = await lookUpFileState(runGit, context);
      if (!after) {
        throw new GitHubPushError("Couldn't read this file's git status.", 500);
      }
      return after.status;
    } finally {
      pushesInFlight.delete(context.root);
    }
  }

  return { status, commitAndPush };
}
