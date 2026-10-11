import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface GitHubRepo {
  owner: string;
  repo: string;
}

export interface GitRunOptions {
  timeoutMs?: number;
  /** Keep stdout exactly as git wrote it, for file contents. */
  untrimmed?: boolean;
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
export const GIT_FETCH_TIMEOUT_MS = 20_000;
/**
 * How often a repository's branch is fetched from origin at most, so that
 * opening files and refocusing the window do not each start a network call.
 */
export const GITHUB_FETCH_INTERVAL_MS = 15_000;
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
    readonly stdout = "",
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
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr ?? "").trim();
          reject(
            new GitCommandError(
              detail || error.message,
              detail,
              error.killed === true,
              String(stdout ?? ""),
            ),
          );
          return;
        }
        resolve(options.untrimmed ? String(stdout) : String(stdout).trim());
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
 * - `synced`: GitHub has this file exactly as it is here.
 * - `changed`: this copy has changes to the file that GitHub lacks.
 * - `behind`: GitHub has changes to the file that this copy lacks.
 * - `diverged`: both sides have changed the file.
 * - `not-pushed`: the link would 404, because GitHub lacks the file or branch.
 * - `ignored`: git ignores the file, so it can never reach GitHub.
 * - `unknown`: HEAD is detached, so there is no branch to compare against.
 *
 * Comparisons use origin's remote-tracking branch, which Roughdraft fetches
 * when a file is opened or the window regains focus.
 */
export type GitHubSyncState =
  | "synced"
  | "changed"
  | "behind"
  | "diverged"
  | "not-pushed"
  | "ignored"
  | "unknown";

export type GitHubSyncReason =
  /** `changed` or `diverged`: there are edits that are not committed. */
  | "uncommitted"
  /** `changed`, `diverged` or `not-pushed`: committed but not on origin. */
  | "unpushed"
  /** `not-pushed`: git does not track the file yet. */
  | "untracked"
  /** `not-pushed`: origin has no copy of the branch. */
  | "branch-not-pushed";

/** What GitHub has for this file that this copy lacks. */
export interface GitHubRemoteChanges {
  /** Commits on origin's branch that change this file. */
  commits: number;
  /** Their authors, most recent first, without repeats. */
  authors: string[];
  /** When the most recent of them was committed, in ms since the epoch. */
  latestAt: number;
  /** GitHub's comparison from this copy's base to origin, opened at this file. */
  compareUrl: string;
  /** The commit origin's branch points at; it identifies this update. */
  head: string;
}

export interface GitHubFileStatus {
  url: string;
  sync: GitHubSyncState;
  reason: GitHubSyncReason | null;
  /** The checked-out branch, or null when HEAD is detached. */
  branch: string | null;
  /** Commits on the branch that origin lacks. Zero without an origin copy. */
  ahead: number;
  /** Commits on origin's branch that this copy lacks, in any file. */
  behind: number;
  /** Whether the file has changes that are not committed. */
  uncommitted: boolean;
  /** Set when GitHub has changes to this file: `behind` or `diverged`. */
  remote: GitHubRemoteChanges | null;
  /** When origin was last fetched, in ms since the epoch, if ever. */
  checkedAt: number | null;
}

interface WorkingTreeStatus {
  commit: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entry: "changed" | "untracked" | "ignored" | null;
}

/** Reads `git status --porcelain=v2 --branch` output for a single path. */
export function parsePorcelainV2Status(output: string): WorkingTreeStatus {
  const status: WorkingTreeStatus = {
    commit: null,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
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
      const match = /^\+(\d+) -(\d+)$/.exec(line.slice("# branch.ab ".length));
      status.ahead = match ? Number(match[1]) : 0;
      status.behind = match ? Number(match[2]) : 0;
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

function trackingRefFor(remoteBranch: string): string {
  return `refs/remotes/origin/${remoteBranch}`;
}

/** GitHub names a file's section of a comparison after its path's SHA-256. */
function gitHubDiffAnchor(relativePath: string): string {
  return `diff-${createHash("sha256").update(relativePath).digest("hex")}`;
}

async function lookUpRemoteChanges(
  runGit: GitRunner,
  { root, repo, relativePath }: FileContext,
  trackingRef: string,
): Promise<GitHubRemoteChanges | null> {
  const [log, head, base] = await Promise.all([
    gitOrNull(
      runGit,
      [
        "log",
        "--format=%an%x1f%ct",
        `HEAD..${trackingRef}`,
        "--",
        literalPathspec(relativePath),
      ],
      root,
    ),
    gitOrNull(runGit, ["rev-parse", trackingRef], root),
    gitOrNull(runGit, ["merge-base", "HEAD", trackingRef], root),
  ]);
  if (!log || !head || !base) return null;
  const entries = log.split("\n").map((line) => {
    const [author = "", time = "0"] = line.split("\x1f");
    return { author, at: Number(time) * 1000 };
  });
  return {
    commits: entries.length,
    authors: [...new Set(entries.map((entry) => entry.author))],
    latestAt: entries[0]?.at ?? 0,
    compareUrl: `https://github.com/${encodeSegments([repo.owner, repo.repo])}/compare/${base}...${head}#${gitHubDiffAnchor(relativePath)}`,
    head,
  };
}

async function lookUpFileState(
  runGit: GitRunner,
  context: FileContext,
  checkedAt: number | null,
): Promise<FileState | null> {
  const { root, repo, relativePath } = context;
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
        behind: 0,
        uncommitted,
        remote: null,
        checkedAt,
      },
      remoteBranch: null,
      hasUpstream: false,
    };
  }

  const trackingRef = trackingRefFor(remoteBranch);
  const trackingExists = await gitSucceeds(
    runGit,
    ["rev-parse", "--verify", "--quiet", `${trackingRef}^{commit}`],
    root,
  );
  let { ahead, behind } = tree;
  if (trackingExists && !tree.upstream?.startsWith("origin/")) {
    const counts = await gitOrNull(
      runGit,
      ["rev-list", "--left-right", "--count", `HEAD...${trackingRef}`],
      root,
    );
    const [left = "0", right = "0"] = (counts ?? "").split(/\s+/);
    ahead = Number(left) || 0;
    behind = Number(right) || 0;
  } else if (!trackingExists) {
    ahead = 0;
    behind = 0;
  }

  const state = (
    sync: GitHubSyncState,
    reason: GitHubSyncReason | null,
    remote: GitHubRemoteChanges | null = null,
  ): FileState => ({
    status: {
      url: buildGitHubBlobUrl(repo, remoteBranch, segments),
      sync,
      reason,
      branch: tree.branch,
      ahead,
      behind,
      uncommitted,
      remote,
      checkedAt,
    },
    remoteBranch,
    hasUpstream: tree.upstream !== null,
  });

  if (tree.entry === "ignored") return state("ignored", null);
  if (!trackingExists) return state("not-pushed", "branch-not-pushed");

  const onOrigin = await gitSucceeds(
    runGit,
    ["cat-file", "-e", `${trackingRef}:${relativePath}`],
    root,
  );
  if (!onOrigin) {
    return state(
      "not-pushed",
      tree.entry === "untracked" ? "untracked" : "unpushed",
    );
  }

  // Three-dot diffs compare each side with the commit both share, so
  // GitHub's changes and this copy's changes are told apart.
  const committedHere =
    ahead > 0 &&
    tree.commit !== null &&
    !(await gitSucceeds(
      runGit,
      ["diff", "--quiet", `${trackingRef}...HEAD`, "--", pathspec],
      root,
    ));
  const changedOnGitHub =
    behind > 0 &&
    tree.commit !== null &&
    !(await gitSucceeds(
      runGit,
      ["diff", "--quiet", `HEAD...${trackingRef}`, "--", pathspec],
      root,
    ));
  const localReason: GitHubSyncReason | null = uncommitted
    ? "uncommitted"
    : committedHere
      ? "unpushed"
      : null;

  if (changedOnGitHub) {
    const remote = await lookUpRemoteChanges(runGit, context, trackingRef);
    return localReason
      ? state("diverged", localReason, remote)
      : state("behind", null, remote);
  }
  if (localReason) return state("changed", localReason);
  return state("synced", null);
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

function errorText(error: unknown): string {
  return redactCredentials(
    error instanceof Error ? error.message : String(error),
  );
}

function lastLine(message: string): string {
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? message).replace(/^(?:error|fatal): /, "");
}

const SIGN_IN_FAILURE =
  /Permission denied|Authentication failed|could not read Username|terminal prompts disabled|Host key verification failed/i;

function describePushFailure(error: unknown): string {
  if (error instanceof GitCommandError && error.timedOut) {
    return "The push to GitHub timed out.";
  }
  const message = errorText(error);
  if (/\[rejected\]|non-fast-forward|fetch first/.test(message)) {
    return "GitHub has commits that this copy doesn't. Update from GitHub, then push again.";
  }
  if (SIGN_IN_FAILURE.test(message)) {
    return "Git couldn't sign in to GitHub. Try pushing once from a terminal to check your credentials.";
  }
  return lastLine(message);
}

function describeUpdateFailure(error: unknown): string {
  if (error instanceof GitCommandError && error.timedOut) {
    return "Updating from GitHub timed out.";
  }
  const message = errorText(error);
  if (/would be overwritten by merge/.test(message)) {
    const files = message
      .split("\n")
      .filter(
        (line) => /^\s+\S/.test(line) && !/^\s*(Please|Aborting)/.test(line),
      )
      .map((line) => line.trim());
    return files.length > 0
      ? `Uncommitted changes here would be overwritten in ${files.join(", ")}. Commit or discard them, then update.`
      : "Uncommitted changes here would be overwritten. Commit or discard them, then update.";
  }
  if (/Not possible to fast-forward/i.test(message)) {
    return "This copy has commits that GitHub doesn't, so it can't simply move to GitHub's version.";
  }
  if (SIGN_IN_FAILURE.test(message)) {
    return "Git couldn't sign in to GitHub. Try fetching once from a terminal to check your credentials.";
  }
  return lastLine(message);
}

export class GitHubActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fileStatus: GitHubFileStatus | null = null,
  ) {
    super(message);
    this.name = "GitHubActionError";
  }
}

export interface GitHubUpdateResult {
  status: GitHubFileStatus;
  /** Whether the file changed on disk. */
  updated: boolean;
  /** What GitHub had for this file before the update. */
  changes: GitHubRemoteChanges | null;
}

/**
 * - `auto`: only when this copy has no changes of its own to the file and
 *   the branch can fast-forward. Used without asking, so it never merges.
 * - `manual`: fast-forwards, or merges when the branch has its own commits,
 *   carrying uncommitted edits across. Refuses beforehand if any of this
 *   copy's changes overlap GitHub's.
 */
export type GitHubUpdateMode = "auto" | "manual";

export interface GitHubFilesOptions {
  runGit?: GitRunner;
  now?: () => number;
  ttlMs?: number;
  fetchIntervalMs?: number;
}

/**
 * GitHub links, sync state, commit-and-push and updating from GitHub for
 * local files. Repository roots are cached per folder and GitHub remotes per
 * repository; the branch and the file's own state are read fresh each time,
 * because they change whenever the file is saved, committed or pushed.
 */
export function createGitHubFiles({
  runGit = defaultGitRunner,
  now = Date.now,
  ttlMs = GITHUB_REPO_CACHE_TTL_MS,
  fetchIntervalMs = GITHUB_FETCH_INTERVAL_MS,
}: GitHubFilesOptions = {}) {
  const rootForDirectory = expiringCache<string | null>(now, ttlMs);
  const repoForRoot = expiringCache<GitHubRepo | null>(now, ttlMs);
  const writesInFlight = new Set<string>();
  const fetches = new Map<string, { startedAt: number; done: Promise<void> }>();
  const checkedAt = new Map<string, number>();

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
      // `get-url` applies `insteadOf` rewrites, which can turn an alias into
      // a GitHub URL or a GitHub URL into a mirror; try both forms.
      for (const args of [
        ["remote", "get-url", "origin"],
        ["config", "--get", "remote.origin.url"],
      ]) {
        const remote = await gitOrNull(runGit, args, root);
        const parsed = remote ? parseGitHubRemoteUrl(remote) : null;
        if (parsed) return parsed;
      }
      return null;
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

  const fetchKey = (root: string, remoteBranch: string) =>
    `${root}\0${remoteBranch}`;

  /**
   * Fetches the branch from origin unless that happened within `maxAgeMs`.
   * Failures, such as being offline, leave the last known state in place.
   */
  function fetchBranch(
    root: string,
    remoteBranch: string,
    maxAgeMs: number,
  ): Promise<void> {
    const key = fetchKey(root, remoteBranch);
    const previous = fetches.get(key);
    if (previous && now() - previous.startedAt < maxAgeMs) {
      return previous.done;
    }
    const done = runGit(
      [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        "origin",
        `+refs/heads/${remoteBranch}:${trackingRefFor(remoteBranch)}`,
      ],
      root,
      { timeoutMs: GIT_FETCH_TIMEOUT_MS },
    ).then(
      () => {
        checkedAt.set(key, now());
      },
      () => {},
    );
    fetches.set(key, { startedAt: now(), done });
    return done;
  }

  function lookUp(context: FileContext, remoteBranch: string | null = null) {
    const fetchedAt = remoteBranch
      ? (checkedAt.get(fetchKey(context.root, remoteBranch)) ?? null)
      : null;
    return lookUpFileState(runGit, context, fetchedAt).then(async (state) => {
      // The branch is only known once status has run; fill in the check
      // time on the first lookup too.
      if (!state || remoteBranch || !state.remoteBranch) return state;
      const time = checkedAt.get(fetchKey(context.root, state.remoteBranch));
      if (time !== undefined) state.status.checkedAt = time;
      return state;
    });
  }

  /**
   * The file's GitHub link and sync state, or null when it has no GitHub
   * home. With `fetch`, first brings origin's copy of the branch up to date,
   * at most once per `fetchIntervalMs`.
   */
  async function status(
    filePath: string,
    { fetch = false }: { fetch?: boolean } = {},
  ): Promise<GitHubFileStatus | null> {
    const context = await fileContext(filePath);
    if (!context) return null;
    const state = await lookUp(context);
    if (!fetch || !state?.remoteBranch) return state?.status ?? null;
    await fetchBranch(context.root, state.remoteBranch, fetchIntervalMs);
    return (await lookUp(context, state.remoteBranch))?.status ?? null;
  }

  async function withWriteLock<T>(
    context: FileContext,
    action: () => Promise<T>,
  ): Promise<T> {
    if (writesInFlight.has(context.root)) {
      throw new GitHubActionError(
        "Roughdraft is already pushing or updating this repository.",
        409,
      );
    }
    writesInFlight.add(context.root);
    try {
      return await action();
    } finally {
      writesInFlight.delete(context.root);
    }
  }

  async function requireContext(filePath: string): Promise<FileContext> {
    const context = await fileContext(filePath);
    if (!context) {
      throw new GitHubActionError(
        "This file isn't in a repository whose origin is on GitHub.",
        409,
      );
    }
    return context;
  }

  /**
   * Commits this file's changes alone, with nothing else that is staged,
   * brings in any newer commits from GitHub, and pushes the branch to origin.
   * Never force-pushes.
   */
  async function commitAndPush(filePath: string): Promise<GitHubFileStatus> {
    const context = await requireContext(filePath);
    return withWriteLock(context, async () => {
      const before = await lookUp(context);
      if (!before) {
        throw new GitHubActionError(
          "Couldn't read this file's git status.",
          500,
        );
      }
      if (!before.remoteBranch) {
        throw new GitHubActionError(
          "Check out a branch before pushing.",
          409,
          before.status,
        );
      }
      if (before.status.sync === "ignored") {
        throw new GitHubActionError(
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
          throw new GitHubActionError(
            `Couldn't commit: ${lastLine(errorText(error))}`,
            500,
            (await lookUp(context))?.status ?? null,
          );
        }
      }

      if (committed || before.status.sync !== "synced") {
        // A push is refused while GitHub has commits this copy lacks, so
        // bring those in first, as long as nothing clashes.
        await fetchBranch(context.root, before.remoteBranch, 0);
        const fresh = await lookUp(context, before.remoteBranch);
        if (fresh && fresh.status.behind > 0) {
          const merged = await integrateFromGitHub(
            context.root,
            trackingRefFor(before.remoteBranch),
          );
          if (!merged.ok) {
            throw new GitHubActionError(
              committed
                ? `Committed, but not pushed. ${merged.message}`
                : merged.message,
              merged.status,
              (await lookUp(context, before.remoteBranch))?.status ?? null,
            );
          }
        }
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
          throw new GitHubActionError(
            committed ? `Committed, but the push failed. ${reason}` : reason,
            502,
            (await lookUp(context))?.status ?? null,
          );
        }
      }

      const after = await lookUp(context, before.remoteBranch);
      if (!after) {
        throw new GitHubActionError(
          "Couldn't read this file's git status.",
          500,
        );
      }
      return after.status;
    });
  }

  /**
   * Files whose uncommitted changes here and GitHub's changes would clash,
   * judged by merging each one in memory. `mergedTree` is what the branch
   * will hold after the update.
   */
  async function clashingUncommittedFiles(
    root: string,
    trackingRef: string,
    mergedTree: string,
  ): Promise<string[]> {
    const [local, incoming] = await Promise.all([
      gitOrNull(runGit, ["diff", "--name-only", "-z", "HEAD"], root),
      gitOrNull(
        runGit,
        ["diff", "--name-only", "-z", `HEAD...${trackingRef}`],
        root,
      ),
    ]);
    const split = (value: string | null) =>
      (value ?? "").split("\0").filter(Boolean);
    const incomingFiles = new Set(split(incoming));
    const overlapping = split(local).filter((file) => incomingFiles.has(file));
    if (overlapping.length === 0) return [];

    const scratch = await fs.mkdtemp(
      path.join(os.tmpdir(), "roughdraft-merge-"),
    );
    try {
      const clashing: string[] = [];
      for (const file of overlapping) {
        const show = (object: string) =>
          runGit(["show", `${object}:${file}`], root, {
            untrimmed: true,
          }).catch(() => "");
        const basePath = path.join(scratch, "base");
        const theirsPath = path.join(scratch, "theirs");
        const oursPath = path.join(scratch, "ours");
        await fs.writeFile(basePath, await show("HEAD"));
        await fs.writeFile(theirsPath, await show(mergedTree));
        const ours = await fs
          .readFile(path.join(root, file))
          .catch(() => Buffer.alloc(0));
        await fs.writeFile(oursPath, ours);
        const clean = await gitSucceeds(
          runGit,
          ["merge-file", "--quiet", "-p", oursPath, basePath, theirsPath],
          root,
        );
        if (!clean) clashing.push(file);
      }
      return clashing;
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
    }
  }

  async function stashCount(root: string): Promise<number> {
    const list = await gitOrNull(
      runGit,
      ["stash", "list", "--format=%H"],
      root,
    );
    return list ? list.split("\n").length : 0;
  }

  /**
   * Brings GitHub's commits into the branch: fast-forwards, or merges when
   * the branch has its own commits, carrying uncommitted edits across. Checks
   * beforehand that nothing would clash, so it never leaves conflicts.
   */
  async function integrateFromGitHub(
    root: string,
    trackingRef: string,
  ): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
    // merge-tree merges the commits in memory: the first line is the
    // resulting tree, and on a conflict (exit 1) the next lines name the
    // conflicting files.
    let mergedTree = "";
    try {
      mergedTree =
        (
          await runGit(
            [
              "merge-tree",
              "--write-tree",
              "--name-only",
              "--no-messages",
              "HEAD",
              trackingRef,
            ],
            root,
            { timeoutMs: GIT_WRITE_TIMEOUT_MS },
          )
        ).split("\n")[0] ?? "";
    } catch (error) {
      const conflicted =
        error instanceof GitCommandError
          ? error.stdout.trim().split("\n").slice(1).filter(Boolean)
          : [];
      return {
        ok: false,
        status: 409,
        message: `Commits here and on GitHub change the same lines${conflicted.length > 0 ? ` of ${conflicted.join(", ")}` : ""}, so Roughdraft can't combine them. See the changes on GitHub, then merge in a terminal.`,
      };
    }
    const clashing = await clashingUncommittedFiles(
      root,
      trackingRef,
      mergedTree,
    );
    if (clashing.length > 0) {
      return {
        ok: false,
        status: 409,
        message: `Your edits and GitHub's change the same lines of ${clashing.join(", ")}, so Roughdraft can't combine them. See the changes on GitHub, then edit to match.`,
      };
    }

    const stashesBefore = await stashCount(root);
    try {
      await runGit(
        ["merge", "--ff", "--no-edit", "--autostash", "--quiet", trackingRef],
        root,
        { timeoutMs: GIT_WRITE_TIMEOUT_MS },
      );
    } catch (error) {
      const merging = await gitSucceeds(
        runGit,
        ["rev-parse", "--quiet", "--verify", "MERGE_HEAD"],
        root,
      );
      if (merging) await runGit(["merge", "--abort"], root).catch(() => {});
      return { ok: false, status: 409, message: describeUpdateFailure(error) };
    }
    if ((await stashCount(root)) > stashesBefore) {
      return {
        ok: false,
        status: 500,
        message:
          "Updated from GitHub, but your uncommitted edits clashed with it. Git kept them in its stash; run `git stash pop` in a terminal to get them back.",
      };
    }
    return { ok: true };
  }

  /**
   * Brings this copy up to date with GitHub's version of the branch. Never
   * rebases or discards anything; refuses rather than leave conflicts.
   */
  async function updateFromGitHub(
    filePath: string,
    mode: GitHubUpdateMode,
  ): Promise<GitHubUpdateResult> {
    const context = await requireContext(filePath);
    return withWriteLock(context, async () => {
      const first = await lookUp(context);
      if (!first?.remoteBranch) {
        throw new GitHubActionError(
          "Check out a branch before updating from GitHub.",
          409,
          first?.status ?? null,
        );
      }
      const { remoteBranch } = first;
      await fetchBranch(context.root, remoteBranch, 0);
      const before = await lookUp(context, remoteBranch);
      if (!before) {
        throw new GitHubActionError(
          "Couldn't read this file's git status.",
          500,
        );
      }
      const { sync } = before.status;
      if (sync !== "behind" && sync !== "diverged") {
        return { status: before.status, updated: false, changes: null };
      }

      const trackingRef = trackingRefFor(remoteBranch);
      const fail = async (message: string, status = 409): Promise<never> => {
        throw new GitHubActionError(
          message,
          status,
          (await lookUp(context, remoteBranch))?.status ?? null,
        );
      };

      if (mode === "auto") {
        if (sync !== "behind" || before.status.ahead > 0) {
          await fail(
            "This copy has changes of its own, so it wasn't updated automatically.",
          );
        }
        try {
          await runGit(
            ["merge", "--ff-only", "--quiet", trackingRef],
            context.root,
            {
              timeoutMs: GIT_WRITE_TIMEOUT_MS,
            },
          );
        } catch (error) {
          await fail(describeUpdateFailure(error));
        }
      } else {
        const merged = await integrateFromGitHub(context.root, trackingRef);
        if (!merged.ok) await fail(merged.message, merged.status);
      }

      const after = await lookUp(context, remoteBranch);
      if (!after) {
        throw new GitHubActionError(
          "Couldn't read this file's git status.",
          500,
        );
      }
      return {
        status: after.status,
        updated: true,
        changes: before.status.remote,
      };
    });
  }

  return { status, commitAndPush, updateFromGitHub };
}
