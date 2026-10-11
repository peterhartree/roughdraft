/** Mirrors `GitHubRemoteChanges` in packages/server/src/github-link.ts. */
export interface GitHubRemoteChanges {
  commits: number;
  authors: string[];
  latestAt: number;
  compareUrl: string;
  head: string;
}

/** Mirrors `GitHubFileStatus` in packages/server/src/github-link.ts. */
export interface GitHubFileStatus {
  url: string;
  sync:
    | "synced"
    | "changed"
    | "behind"
    | "diverged"
    | "not-pushed"
    | "ignored"
    | "unknown";
  reason: "uncommitted" | "unpushed" | "untracked" | "branch-not-pushed" | null;
  branch: string | null;
  ahead: number;
  behind: number;
  uncommitted: boolean;
  remote: GitHubRemoteChanges | null;
  checkedAt: number | null;
}

function isGitHubFileStatus(value: unknown): value is GitHubFileStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<GitHubFileStatus>;
  return typeof status.url === "string" && typeof status.sync === "string";
}

/**
 * With `fetch`, the server first brings origin's copy of the branch up to
 * date, which needs the network; without it the answer is local and quick.
 */
export async function fetchGitHubFileStatus(
  path: string,
  { fetch: fetchOrigin = false }: { fetch?: boolean } = {},
): Promise<GitHubFileStatus | null> {
  const query = new URLSearchParams({ path });
  if (fetchOrigin) query.set("fetch", "1");
  const response = await fetch(`/api/github-link?${query}`);
  if (!response.ok) return null;
  const body: unknown = await response.json();
  return isGitHubFileStatus(body) ? body : null;
}

export type CommitAndPushResult =
  | { ok: true; status: GitHubFileStatus }
  | { ok: false; error: string; status: GitHubFileStatus | null };

export async function commitAndPushFile(
  path: string,
): Promise<CommitAndPushResult> {
  try {
    const response = await fetch("/api/github-link/commit-and-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
      status?: unknown;
    } | null;
    if (response.ok && isGitHubFileStatus(body)) {
      return { ok: true, status: body };
    }
    return {
      ok: false,
      error:
        typeof body?.error === "string"
          ? body.error
          : "Couldn't push to GitHub.",
      status: isGitHubFileStatus(body?.status) ? body.status : null,
    };
  } catch {
    return {
      ok: false,
      error: "Couldn't reach Roughdraft to push.",
      status: null,
    };
  }
}

export type GitHubUpdateMode = "auto" | "manual";

export type GitHubUpdateResult =
  | {
      ok: true;
      status: GitHubFileStatus;
      updated: boolean;
      changes: GitHubRemoteChanges | null;
    }
  | { ok: false; error: string; status: GitHubFileStatus | null };

export async function updateFileFromGitHub(
  path: string,
  mode: GitHubUpdateMode,
): Promise<GitHubUpdateResult> {
  try {
    const response = await fetch("/api/github-link/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, mode }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
      status?: unknown;
      updated?: unknown;
      changes?: GitHubRemoteChanges | null;
    } | null;
    if (response.ok && isGitHubFileStatus(body?.status)) {
      return {
        ok: true,
        status: body.status,
        updated: body.updated === true,
        changes: body.changes ?? null,
      };
    }
    return {
      ok: false,
      error:
        typeof body?.error === "string"
          ? body.error
          : "Couldn't update from GitHub.",
      status: isGitHubFileStatus(body?.status) ? body.status : null,
    };
  } catch {
    return {
      ok: false,
      error: "Couldn't reach Roughdraft to update from GitHub.",
      status: null,
    };
  }
}

/** Whether the GitHub link leads to this file; otherwise it would 404. */
export function gitHubLinkWorks(status: GitHubFileStatus): boolean {
  return status.sync !== "not-pushed" && status.sync !== "ignored";
}

export function gitHubLinkLabel(status: GitHubFileStatus): string {
  switch (status.sync) {
    case "changed":
      return "View on GitHub (without your latest changes)";
    case "behind":
    case "diverged":
      return "View on GitHub (newer than this copy)";
    case "ignored":
      return "Not on GitHub: git ignores this file";
    case "not-pushed":
      if (status.reason === "untracked") {
        return "Not on GitHub yet: this file hasn't been committed";
      }
      if (status.reason === "branch-not-pushed" && status.branch) {
        return `Not on GitHub yet: the ${status.branch} branch hasn't been pushed`;
      }
      return "Not on GitHub yet: this file hasn't been pushed";
    default:
      return "View on GitHub";
  }
}

/** Whether there is anything for commit-and-push to send. */
export function canCommitAndPush(status: GitHubFileStatus): boolean {
  return (
    status.branch !== null &&
    (status.sync === "changed" || status.sync === "not-pushed")
  );
}

function commits(count: number) {
  return `${count} ${count === 1 ? "commit" : "commits"}`;
}

export function commitAndPushLabel(status: GitHubFileStatus): string {
  const newBranch = status.reason === "branch-not-pushed" && status.branch;
  if (status.uncommitted) {
    if (newBranch) {
      return `Commit and push to a new ${status.branch} branch on GitHub`;
    }
    return status.ahead > 0
      ? `Commit and push to GitHub, with ${commits(status.ahead)} made earlier`
      : "Commit and push to GitHub";
  }
  if (newBranch) return `Push the ${status.branch} branch to GitHub`;
  return status.ahead > 0
    ? `Push ${commits(status.ahead)} to GitHub`
    : "Push to GitHub";
}

/** Whether GitHub has changes to this file that this copy can take. */
export function canUpdateFromGitHub(status: GitHubFileStatus): boolean {
  return (
    status.branch !== null &&
    (status.sync === "behind" || status.sync === "diverged")
  );
}

/**
 * Whether Roughdraft may update without asking: GitHub changed the file, this
 * copy didn't, and the branch can simply move to GitHub's version.
 */
export function canUpdateAutomatically(status: GitHubFileStatus): boolean {
  return (
    status.branch !== null && status.sync === "behind" && status.ahead === 0
  );
}

function newCommits(count: number) {
  return `${count} new ${count === 1 ? "commit" : "commits"}`;
}

function authorList(authors: string[]) {
  if (authors.length <= 1) return authors[0] ?? "someone";
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
  return `${authors[0]} and ${authors.length - 1} others`;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60_000],
  ["month", 30 * 24 * 60 * 60_000],
  ["week", 7 * 24 * 60 * 60_000],
  ["day", 24 * 60 * 60_000],
  ["hour", 60 * 60_000],
  ["minute", 60_000],
];

export function relativeTime(at: number, now: number): string {
  const elapsed = now - at;
  if (elapsed < 60_000) return "just now";
  const format = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (elapsed >= size)
      return format.format(-Math.floor(elapsed / size), unit);
  }
  return "just now";
}

/** "2 new commits from Max, the latest 14 minutes ago". */
export function describeRemoteChanges(
  changes: GitHubRemoteChanges,
  now: number,
): string {
  const when = relativeTime(changes.latestAt, now);
  return changes.commits === 1
    ? `${newCommits(1)} from ${authorList(changes.authors)}, ${when}`
    : `${newCommits(changes.commits)} from ${authorList(changes.authors)}, the latest ${when}`;
}

export interface GitHubBannerCopy {
  tone: "info" | "warning";
  title: string;
  detail: string;
  action: string;
}

/** The banner shown while GitHub has a newer version of the file. */
export function gitHubUpdateBannerCopy(
  status: GitHubFileStatus,
  fileName: string,
  now: number,
): GitHubBannerCopy | null {
  if (!status.remote || !canUpdateFromGitHub(status)) return null;
  const changes = describeRemoteChanges(status.remote, now);
  if (status.sync === "diverged") {
    return {
      tone: "warning",
      title: `GitHub and this copy both changed ${fileName}`,
      detail: `${changes}. Your edits here aren't pushed yet.`,
      action: "Update and keep my edits",
    };
  }
  return {
    tone: "info",
    title: `GitHub has a newer version of ${fileName}`,
    detail: `${changes}.`,
    action: "Update to latest",
  };
}

export function updatedFromGitHubCopy(
  changes: GitHubRemoteChanges | null,
  fileName: string,
  now: number,
): { title: string; detail: string } {
  return {
    title: `Updated ${fileName} from GitHub`,
    detail: changes
      ? `${describeRemoteChanges(changes, now)}. Changed passages are marked.`
      : "Changed passages are marked.",
  };
}

export function updateFromGitHubLabel(status: GitHubFileStatus): string {
  if (status.sync === "diverged") {
    return "Update from GitHub, keeping your edits";
  }
  return status.remote
    ? `Update from GitHub (${newCommits(status.remote.commits)})`
    : "Update from GitHub";
}
