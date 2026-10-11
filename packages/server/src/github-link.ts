import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface GitHubRepo {
  owner: string;
  repo: string;
}

/** Runs `git` with the given arguments in `cwd`; resolves to trimmed stdout. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>;

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
export const GITHUB_LINK_CACHE_TTL_MS = 10_000;

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

export const defaultGitRunner: GitRunner = (args, cwd) =>
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
      { cwd, env, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
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

/**
 * The ref to link to: the checked-out branch (under its origin name when it
 * tracks one), else origin's default branch, else the commit.
 */
async function resolveRef(
  runGit: GitRunner,
  root: string,
): Promise<string | null> {
  const branch = await gitOrNull(
    runGit,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    root,
  );
  if (branch) {
    const upstream = await gitOrNull(
      runGit,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      root,
    );
    return upstream?.startsWith("origin/")
      ? upstream.slice("origin/".length)
      : branch;
  }

  const originHead = await gitOrNull(
    runGit,
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    root,
  );
  if (originHead?.startsWith("origin/")) {
    return originHead.slice("origin/".length);
  }
  return gitOrNull(runGit, ["rev-parse", "--verify", "--quiet", "HEAD"], root);
}

interface RepoLink {
  repo: GitHubRepo;
  ref: string;
}

async function lookUpRepoRoot(
  runGit: GitRunner,
  directory: string,
): Promise<string | null> {
  const topLevel = await gitOrNull(
    runGit,
    ["rev-parse", "--show-toplevel"],
    directory,
  );
  if (!topLevel) return null;
  return fs.realpath(topLevel).catch(() => null);
}

async function lookUpRepoLink(
  runGit: GitRunner,
  root: string,
): Promise<RepoLink | null> {
  const remote = await gitOrNull(runGit, ["remote", "get-url", "origin"], root);
  const repo = remote ? parseGitHubRemoteUrl(remote) : null;
  if (!repo) return null;

  const ref = await resolveRef(runGit, root);
  return ref ? { repo, ref } : null;
}

export interface GitHubLinkResolverOptions {
  runGit?: GitRunner;
  now?: () => number;
  ttlMs?: number;
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

/**
 * Returns a function that maps an absolute file path to its GitHub blob URL,
 * or null when the file is not in a git repository whose `origin` is on
 * GitHub. Repository roots are cached per directory and remote and branch per
 * repository root, briefly: switching between files in one repository spawns
 * at most one git process, and branch changes still show up within seconds.
 */
export function createGitHubLinkResolver({
  runGit = defaultGitRunner,
  now = Date.now,
  ttlMs = GITHUB_LINK_CACHE_TTL_MS,
}: GitHubLinkResolverOptions = {}) {
  const rootForDirectory = expiringCache<string | null>(now, ttlMs);
  const linkForRoot = expiringCache<RepoLink | null>(now, ttlMs);

  return async function resolveGitHubLink(
    filePath: string,
  ): Promise<string | null> {
    // Resolve symlinks first: git reports the physical repository root, and
    // the link should point at the file the symlink leads to.
    const realPath = await fs.realpath(filePath).catch(() => null);
    if (!realPath) return null;

    const directory = path.dirname(realPath);
    const root = await rootForDirectory(directory, () =>
      lookUpRepoRoot(runGit, directory),
    );
    if (!root) return null;
    const link = await linkForRoot(root, () => lookUpRepoLink(runGit, root));
    if (!link) return null;

    const relativePath = path.relative(root, realPath);
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return null;
    }
    return buildGitHubBlobUrl(
      link.repo,
      link.ref,
      relativePath.split(path.sep),
    );
  };
}
