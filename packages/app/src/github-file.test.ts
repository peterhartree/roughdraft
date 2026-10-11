import { describe, expect, it } from "vitest";
import {
  canCommitAndPush,
  canUpdateAutomatically,
  canUpdateFromGitHub,
  commitAndPushLabel,
  describeRemoteChanges,
  type GitHubFileStatus,
  type GitHubRemoteChanges,
  gitHubLinkLabel,
  gitHubLinkWorks,
  gitHubUpdateBannerCopy,
  relativeTime,
  updatedFromGitHubCopy,
  updateFromGitHubLabel,
} from "./github-file";

function status(overrides: Partial<GitHubFileStatus>): GitHubFileStatus {
  return {
    url: "https://github.com/o/r/blob/main/README.md",
    sync: "synced",
    reason: null,
    branch: "main",
    ahead: 0,
    behind: 0,
    uncommitted: false,
    remote: null,
    checkedAt: null,
    ...overrides,
  };
}

describe("GitHub link", () => {
  it("works when GitHub has the file, even an older version of it", () => {
    expect(gitHubLinkWorks(status({ sync: "synced" }))).toBe(true);
    expect(gitHubLinkWorks(status({ sync: "changed" }))).toBe(true);
    expect(gitHubLinkWorks(status({ sync: "unknown", branch: null }))).toBe(
      true,
    );
  });

  it("is broken when GitHub lacks the file or never will have it", () => {
    expect(gitHubLinkWorks(status({ sync: "not-pushed" }))).toBe(false);
    expect(gitHubLinkWorks(status({ sync: "ignored" }))).toBe(false);
  });

  it.each([
    [{ sync: "synced" }, "View on GitHub"],
    [
      { sync: "changed", reason: "uncommitted" },
      "View on GitHub (without your latest changes)",
    ],
    [
      { sync: "not-pushed", reason: "untracked" },
      "Not on GitHub yet: this file hasn't been committed",
    ],
    [
      { sync: "not-pushed", reason: "unpushed" },
      "Not on GitHub yet: this file hasn't been pushed",
    ],
    [
      { sync: "not-pushed", reason: "branch-not-pushed", branch: "review" },
      "Not on GitHub yet: the review branch hasn't been pushed",
    ],
    [{ sync: "ignored" }, "Not on GitHub: git ignores this file"],
  ] as const)("labels %j as %j", (overrides, label) => {
    expect(gitHubLinkLabel(status(overrides))).toBe(label);
  });
});

describe("commit and push", () => {
  it("is offered only on a branch with something GitHub lacks", () => {
    expect(canCommitAndPush(status({ sync: "changed" }))).toBe(true);
    expect(canCommitAndPush(status({ sync: "not-pushed" }))).toBe(true);
    expect(canCommitAndPush(status({ sync: "synced" }))).toBe(false);
    expect(canCommitAndPush(status({ sync: "ignored" }))).toBe(false);
    expect(canCommitAndPush(status({ sync: "changed", branch: null }))).toBe(
      false,
    );
  });

  it.each([
    [{ uncommitted: true }, "Commit and push to GitHub"],
    [
      { uncommitted: true, ahead: 2 },
      "Commit and push to GitHub, with 2 commits made earlier",
    ],
    [{ uncommitted: false, ahead: 1 }, "Push 1 commit to GitHub"],
    [
      { uncommitted: true, reason: "branch-not-pushed", branch: "review" },
      "Commit and push to a new review branch on GitHub",
    ],
    [
      { uncommitted: false, reason: "branch-not-pushed", branch: "review" },
      "Push the review branch to GitHub",
    ],
  ] as const)("names the action for %j as %j", (overrides, label) => {
    expect(commitAndPushLabel(status({ sync: "changed", ...overrides }))).toBe(
      label,
    );
  });
});

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const MINUTE = 60_000;

function changes(overrides: Partial<GitHubRemoteChanges> = {}) {
  return {
    commits: 2,
    authors: ["Max"],
    latestAt: NOW - 14 * MINUTE,
    compareUrl: "https://github.com/o/r/compare/a...b",
    head: "b",
    ...overrides,
  };
}

describe("newer on GitHub", () => {
  it("describes who changed the file and when", () => {
    expect(describeRemoteChanges(changes(), NOW)).toBe(
      "2 new commits from Max, the latest 14 minutes ago",
    );
    expect(
      describeRemoteChanges(
        changes({ commits: 1, latestAt: NOW - 10_000 }),
        NOW,
      ),
    ).toBe("1 new commit from Max, just now");
    expect(
      describeRemoteChanges(
        changes({ commits: 3, authors: ["Max", "Fin", "Rose"] }),
        NOW,
      ),
    ).toBe("3 new commits from Max and 2 others, the latest 14 minutes ago");
    expect(relativeTime(NOW - 26 * 60 * MINUTE, NOW)).toBe("yesterday");
  });

  it("asks to update when only GitHub changed the file", () => {
    expect(
      gitHubUpdateBannerCopy(
        status({ sync: "behind", remote: changes() }),
        "README.md",
        NOW,
      ),
    ).toEqual({
      tone: "info",
      title: "GitHub has a newer version of README.md",
      detail: "2 new commits from Max, the latest 14 minutes ago.",
      action: "Update to latest",
    });
  });

  it("warns, and offers to keep your edits, when both sides changed it", () => {
    expect(
      gitHubUpdateBannerCopy(
        status({ sync: "diverged", reason: "uncommitted", remote: changes() }),
        "README.md",
        NOW,
      ),
    ).toEqual({
      tone: "warning",
      title: "GitHub and this copy both changed README.md",
      detail:
        "2 new commits from Max, the latest 14 minutes ago. Your edits here aren't pushed yet.",
      action: "Update and keep my edits",
    });
  });

  it("has no banner when GitHub has nothing newer", () => {
    expect(gitHubUpdateBannerCopy(status({}), "README.md", NOW)).toBeNull();
  });

  it("updates without asking only when this copy has no changes of its own", () => {
    expect(
      canUpdateAutomatically(status({ sync: "behind", remote: changes() })),
    ).toBe(true);
    expect(
      canUpdateAutomatically(
        status({ sync: "behind", ahead: 1, remote: changes() }),
      ),
    ).toBe(false);
    expect(
      canUpdateAutomatically(status({ sync: "diverged", remote: changes() })),
    ).toBe(false);
    expect(
      canUpdateAutomatically(
        status({ sync: "behind", branch: null, remote: changes() }),
      ),
    ).toBe(false);
  });

  it("swaps the push button for an update button while GitHub is newer", () => {
    const behind = status({ sync: "behind", remote: changes() });
    expect(canUpdateFromGitHub(behind)).toBe(true);
    expect(canCommitAndPush(behind)).toBe(false);
    expect(updateFromGitHubLabel(behind)).toBe(
      "Update from GitHub (2 new commits)",
    );
    expect(
      updateFromGitHubLabel(status({ sync: "diverged", remote: changes() })),
    ).toBe("Update from GitHub, keeping your edits");
    expect(gitHubLinkLabel(behind)).toBe(
      "View on GitHub (newer than this copy)",
    );
  });

  it("says what an update brought in", () => {
    expect(updatedFromGitHubCopy(changes(), "README.md", NOW)).toEqual({
      title: "Updated README.md from GitHub",
      detail:
        "2 new commits from Max, the latest 14 minutes ago. Changed passages are marked.",
    });
  });
});
