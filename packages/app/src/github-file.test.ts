import { describe, expect, it } from "vitest";
import {
  canCommitAndPush,
  commitAndPushLabel,
  type GitHubFileStatus,
  gitHubLinkLabel,
  gitHubLinkWorks,
} from "./github-file";

function status(overrides: Partial<GitHubFileStatus>): GitHubFileStatus {
  return {
    url: "https://github.com/o/r/blob/main/README.md",
    sync: "synced",
    reason: null,
    branch: "main",
    ahead: 0,
    uncommitted: false,
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
