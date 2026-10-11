/** Mirrors `GitHubFileStatus` in packages/server/src/github-link.ts. */
export interface GitHubFileStatus {
  url: string;
  sync: "synced" | "changed" | "not-pushed" | "ignored" | "unknown";
  reason: "uncommitted" | "unpushed" | "untracked" | "branch-not-pushed" | null;
  branch: string | null;
  ahead: number;
  uncommitted: boolean;
}

function isGitHubFileStatus(value: unknown): value is GitHubFileStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<GitHubFileStatus>;
  return typeof status.url === "string" && typeof status.sync === "string";
}

export async function fetchGitHubFileStatus(
  path: string,
): Promise<GitHubFileStatus | null> {
  const query = new URLSearchParams({ path });
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

/** Whether the GitHub link leads to this file; otherwise it would 404. */
export function gitHubLinkWorks(status: GitHubFileStatus): boolean {
  return status.sync !== "not-pushed" && status.sync !== "ignored";
}

export function gitHubLinkLabel(status: GitHubFileStatus): string {
  switch (status.sync) {
    case "changed":
      return "View on GitHub (without your latest changes)";
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
