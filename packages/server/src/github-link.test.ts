import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGitHubBlobUrl,
  createGitHubFiles,
  defaultGitRunner,
  type GitRunner,
  parseGitHubRemoteUrl,
} from "./github-link";
import { createApp } from "./index";

describe("parseGitHubRemoteUrl", () => {
  it.each([
    "git@github.com:HartreeWorks/roughdraft.git",
    "git@github.com:HartreeWorks/roughdraft",
    "github.com:HartreeWorks/roughdraft.git",
    "ssh://git@github.com/HartreeWorks/roughdraft.git",
    "ssh://git@ssh.github.com:443/HartreeWorks/roughdraft.git",
    "git+ssh://git@github.com/HartreeWorks/roughdraft.git",
    "git://github.com/HartreeWorks/roughdraft.git",
    "https://github.com/HartreeWorks/roughdraft",
    "https://github.com/HartreeWorks/roughdraft.git",
    "https://github.com/HartreeWorks/roughdraft/",
    "https://www.github.com/HartreeWorks/roughdraft.git",
    "http://github.com/HartreeWorks/roughdraft.git",
    "https://GitHub.com/HartreeWorks/roughdraft.git",
    "  https://github.com/HartreeWorks/roughdraft.git\n",
  ])("reads the owner and repository from %s", (remote) => {
    expect(parseGitHubRemoteUrl(remote)).toEqual({
      owner: "HartreeWorks",
      repo: "roughdraft",
    });
  });

  it("drops credentials embedded in an https remote", () => {
    const repo = parseGitHubRemoteUrl(
      "https://peter:ghp_secret@github.com/HartreeWorks/roughdraft.git",
    );
    expect(repo).toEqual({ owner: "HartreeWorks", repo: "roughdraft" });
    expect(JSON.stringify(repo)).not.toContain("ghp_secret");
  });

  it("keeps dots in repository names", () => {
    expect(
      parseGitHubRemoteUrl("git@github.com:HartreeWorks/hartreeworks.org.git"),
    ).toEqual({ owner: "HartreeWorks", repo: "hartreeworks.org" });
  });

  it.each([
    "",
    "git@gitlab.com:HartreeWorks/roughdraft.git",
    "https://gitlab.com/HartreeWorks/roughdraft.git",
    "https://github.example.com/HartreeWorks/roughdraft.git",
    "https://notgithub.com/HartreeWorks/roughdraft.git",
    "https://github.com/HartreeWorks",
    "https://github.com/HartreeWorks/roughdraft/tree/main",
    "/Users/ph/repos/roughdraft.git",
    "file:///Users/ph/repos/roughdraft.git",
    "../roughdraft.git",
  ])("rejects %j", (remote) => {
    expect(parseGitHubRemoteUrl(remote)).toBeNull();
  });
});

describe("buildGitHubBlobUrl", () => {
  it("joins the repository, ref and repo-relative path", () => {
    expect(
      buildGitHubBlobUrl(
        { owner: "HartreeWorks", repo: "example-notes" },
        "main",
        ["context", "team-strategy", "README.md"],
      ),
    ).toBe(
      "https://github.com/HartreeWorks/example-notes/blob/main/context/team-strategy/README.md",
    );
  });

  it("encodes each path segment without encoding the separators", () => {
    expect(
      buildGitHubBlobUrl({ owner: "o", repo: "r" }, "feature/q&a #2", [
        "notes and plans",
        "100% done?.md",
      ]),
    ).toBe(
      "https://github.com/o/r/blob/feature/q%26a%20%232/notes%20and%20plans/100%25%20done%3F.md",
    );
  });
});

// Repositories below use a GitHub-shaped origin URL, so they count as GitHub
// repositories, and an `insteadOf` rewrite to a local bare repository, so
// fetching and pushing never leave this machine.
let tempDir: string;

beforeEach(() => {
  tempDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-github-link-")),
  );
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();
}

interface TestRepo {
  repoDir: string;
  remoteDir: string;
  write: (relativePath: string, content?: string) => string;
  commitAll: (message?: string) => void;
  /** Files on origin's main branch, as the bare repository holds them. */
  remoteFile: (relativePath: string, branch?: string) => string | null;
  /** Commits a change to origin from another clone, as a colleague would. */
  pushFromElsewhere: (
    relativePath: string,
    content: string,
    author?: string,
  ) => void;
}

function createRepo({
  origin = "git@github.com:HartreeWorks/example-notes.git",
}: {
  origin?: string | null;
} = {}): TestRepo {
  const repoDir = path.join(tempDir, "repo");
  const remoteDir = path.join(tempDir, "remote.git");
  fs.mkdirSync(repoDir);
  git(tempDir, "init", "--quiet", "--bare", "--initial-branch=main", remoteDir);
  git(repoDir, "init", "--quiet", "--initial-branch=main");
  // Repository-local settings outrank the developer's global git config, so
  // the server's own git runs commit predictably here too.
  git(repoDir, "config", "user.name", "Test");
  git(repoDir, "config", "user.email", "test@example.com");
  git(repoDir, "config", "commit.gpgsign", "false");
  const hooksDir = path.join(tempDir, "no-hooks");
  fs.mkdirSync(hooksDir);
  git(repoDir, "config", "core.hooksPath", hooksDir);
  if (origin) {
    git(repoDir, "remote", "add", "origin", origin);
    git(repoDir, "config", `url.${remoteDir}.insteadOf`, origin);
  }

  const write = (relativePath: string, content = "# Note\n") => {
    const filePath = path.join(repoDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
  };
  const commitAll = (message = "change") => {
    git(repoDir, "add", "--all");
    git(repoDir, "commit", "--quiet", "-m", message);
  };
  const remoteFile = (relativePath: string, branch = "main") => {
    try {
      return git(remoteDir, "show", `${branch}:${relativePath}`);
    } catch {
      return null;
    }
  };
  let clones = 0;
  const pushFromElsewhere = (
    relativePath: string,
    content: string,
    author = "Max",
  ) => {
    clones += 1;
    const cloneDir = path.join(tempDir, `elsewhere-${clones}`);
    git(tempDir, "clone", "--quiet", remoteDir, cloneDir);
    git(cloneDir, "config", "user.name", author);
    git(cloneDir, "config", "user.email", "elsewhere@example.com");
    git(cloneDir, "config", "commit.gpgsign", "false");
    const filePath = path.join(cloneDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    git(cloneDir, "add", "--all");
    git(cloneDir, "commit", "--quiet", "-m", `edit ${relativePath}`);
    git(cloneDir, "push", "--quiet");
  };
  return {
    repoDir,
    remoteDir,
    write,
    commitAll,
    remoteFile,
    pushFromElsewhere,
  };
}

/** A repository whose README is committed and pushed to origin's main. */
function createPushedRepo() {
  const repo = createRepo();
  const filePath = repo.write("context/strategy notes/README.md", "# One\n");
  repo.commitAll("init");
  git(repo.repoDir, "push", "--quiet", "--set-upstream", "origin", "main");
  return { ...repo, filePath };
}

function countingGit() {
  const calls: string[] = [];
  const run: GitRunner = (args, cwd, options) => {
    calls.push(args.join(" "));
    return defaultGitRunner(args, cwd, options);
  };
  return { run, calls };
}

const README_URL =
  "https://github.com/HartreeWorks/example-notes/blob/main/context/strategy%20notes/README.md";

describe("GitHub file status", { timeout: 30_000 }, () => {
  it("links a pushed file to its blob on the checked-out branch", async () => {
    const { filePath } = createPushedRepo();

    expect(await createGitHubFiles().status(filePath)).toEqual({
      url: README_URL,
      sync: "synced",
      reason: null,
      branch: "main",
      ahead: 0,
      behind: 0,
      uncommitted: false,
      remote: null,
      checkedAt: null,
    });
  });

  it("reports uncommitted edits as an older version on GitHub", async () => {
    const { filePath } = createPushedRepo();
    fs.appendFileSync(filePath, "More\n");

    expect(await createGitHubFiles().status(filePath)).toMatchObject({
      sync: "changed",
      reason: "uncommitted",
      uncommitted: true,
    });
  });

  it("reports a committed but unpushed edit as an older version on GitHub", async () => {
    const repo = createPushedRepo();
    fs.appendFileSync(repo.filePath, "More\n");
    repo.commitAll();

    expect(await createGitHubFiles().status(repo.filePath)).toMatchObject({
      sync: "changed",
      reason: "unpushed",
      ahead: 1,
      uncommitted: false,
    });
  });

  it("stays synced when unpushed commits leave this file alone", async () => {
    const repo = createPushedRepo();
    repo.write("other.md");
    repo.commitAll();

    expect(await createGitHubFiles().status(repo.filePath)).toMatchObject({
      sync: "synced",
      ahead: 1,
    });
  });

  it("reports a new file as not on GitHub yet", async () => {
    const repo = createPushedRepo();
    const newPath = repo.write("plans/new.md");

    expect(await createGitHubFiles().status(newPath)).toMatchObject({
      sync: "not-pushed",
      reason: "untracked",
      uncommitted: true,
    });

    repo.commitAll();
    expect(await createGitHubFiles().status(newPath)).toMatchObject({
      sync: "not-pushed",
      reason: "unpushed",
      uncommitted: false,
    });
  });

  it("reports a branch that origin lacks as not on GitHub yet", async () => {
    const repo = createPushedRepo();
    git(repo.repoDir, "switch", "--quiet", "-c", "review/draft");

    expect(await createGitHubFiles().status(repo.filePath)).toMatchObject({
      url: README_URL.replace("/blob/main/", "/blob/review/draft/"),
      sync: "not-pushed",
      reason: "branch-not-pushed",
      branch: "review/draft",
    });
  });

  it("links under the upstream's name when the local branch is named differently", async () => {
    const repo = createPushedRepo();
    git(repo.repoDir, "switch", "--quiet", "-c", "local-name");
    git(repo.repoDir, "push", "--quiet", "origin", "local-name:remote-name");
    git(
      repo.repoDir,
      "branch",
      "--quiet",
      "--set-upstream-to=origin/remote-name",
    );

    expect(await createGitHubFiles().status(repo.filePath)).toMatchObject({
      url: README_URL.replace("/blob/main/", "/blob/remote-name/"),
      sync: "synced",
      branch: "local-name",
    });
  });

  it("reports a gitignored file as never reaching GitHub", async () => {
    const repo = createPushedRepo();
    repo.write(".gitignore", ".context/\n");
    repo.commitAll();
    const planPath = repo.write(".context/plan.md");

    expect(await createGitHubFiles().status(planPath)).toMatchObject({
      sync: "ignored",
      reason: null,
    });
  });

  it("falls back to the commit when HEAD is detached", async () => {
    const repo = createPushedRepo();
    const sha = git(repo.repoDir, "rev-parse", "HEAD");
    git(repo.repoDir, "switch", "--quiet", "--detach");

    expect(await createGitHubFiles().status(repo.filePath)).toMatchObject({
      url: README_URL.replace("/blob/main/", `/blob/${sha}/`),
      sync: "unknown",
      branch: null,
    });
  });

  it("resolves a file reached through a symlinked folder", async () => {
    const repo = createPushedRepo();
    const linkDir = path.join(tempDir, "linked-repo");
    fs.symlinkSync(repo.repoDir, linkDir);

    const status = await createGitHubFiles().status(
      path.join(linkDir, path.relative(repo.repoDir, repo.filePath)),
    );
    expect(status?.url).toBe(README_URL);
  });

  it("has no GitHub home without a GitHub origin, outside git, or for missing files", async () => {
    const gitlab = createRepo({ origin: "git@gitlab.com:o/r.git" });
    const gitlabFile = gitlab.write("a.md");
    gitlab.commitAll();
    const files = createGitHubFiles();

    expect(await files.status(gitlabFile)).toBeNull();
    const loosePath = path.join(tempDir, "loose.md");
    fs.writeFileSync(loosePath, "# Loose\n");
    expect(await files.status(loosePath)).toBeNull();
    expect(await files.status(path.join(tempDir, "missing.md"))).toBeNull();
  });

  it("has no GitHub home without an origin remote", async () => {
    const repo = createRepo({ origin: null });
    const filePath = repo.write("a.md");
    repo.commitAll();

    expect(await createGitHubFiles().status(filePath)).toBeNull();
  });

  it("reuses the repository root and remote but rereads the branch", async () => {
    const repo = createPushedRepo();
    const otherPath = repo.write("context/strategy notes/other.md");
    const gitCalls = countingGit();
    const files = createGitHubFiles({ runGit: gitCalls.run });

    await files.status(repo.filePath);
    gitCalls.calls.length = 0;
    await files.status(otherPath);

    expect(gitCalls.calls).not.toContainEqual(
      expect.stringMatching(/^rev-parse --show-toplevel|^remote get-url/),
    );
    expect(gitCalls.calls).toContainEqual(expect.stringContaining("status"));
  });

  it("looks the repository up again once the cache entry expires", async () => {
    const repo = createPushedRepo();
    let now = 0;
    const gitCalls = countingGit();
    const files = createGitHubFiles({
      runGit: gitCalls.run,
      now: () => now,
      ttlMs: 1000,
    });

    await files.status(repo.filePath);
    now = 1001;
    gitCalls.calls.length = 0;
    await files.status(repo.filePath);

    expect(gitCalls.calls).toContain("remote get-url origin");
  });
});

describe("commit and push", { timeout: 30_000 }, () => {
  it("commits only this file's changes and pushes them to origin", async () => {
    const repo = createPushedRepo();
    fs.writeFileSync(repo.filePath, "# Two\n");
    const stagedPath = repo.write("staged.md", "# Staged elsewhere\n");
    git(repo.repoDir, "add", "staged.md");

    const status = await createGitHubFiles().commitAndPush(repo.filePath);

    expect(status).toMatchObject({ sync: "synced", ahead: 0 });
    expect(repo.remoteFile("context/strategy notes/README.md")).toBe("# Two");
    expect(git(repo.repoDir, "log", "-1", "--format=%s")).toBe(
      "docs: update context/strategy notes/README.md",
    );
    // Other staged work stays staged and uncommitted.
    expect(repo.remoteFile("staged.md")).toBeNull();
    expect(git(repo.repoDir, "diff", "--cached", "--name-only")).toBe(
      path.basename(stagedPath),
    );
  });

  it("adds and pushes a file git does not track yet", async () => {
    const repo = createPushedRepo();
    const newPath = repo.write("plans/new plan.md", "# New\n");

    const status = await createGitHubFiles().commitAndPush(newPath);

    expect(status).toMatchObject({ sync: "synced" });
    expect(repo.remoteFile("plans/new plan.md")).toBe("# New");
  });

  it("pushes a new branch and sets its upstream", async () => {
    const repo = createPushedRepo();
    git(repo.repoDir, "switch", "--quiet", "-c", "review/draft");
    fs.writeFileSync(repo.filePath, "# Draft\n");

    const status = await createGitHubFiles().commitAndPush(repo.filePath);

    expect(status).toMatchObject({ sync: "synced", branch: "review/draft" });
    expect(
      repo.remoteFile("context/strategy notes/README.md", "review/draft"),
    ).toBe("# Draft");
    expect(git(repo.repoDir, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe(
      "origin/review/draft",
    );
  });

  it("pushes an earlier commit without making a new one", async () => {
    const repo = createPushedRepo();
    fs.writeFileSync(repo.filePath, "# Committed\n");
    repo.commitAll("by hand");

    await createGitHubFiles().commitAndPush(repo.filePath);

    expect(repo.remoteFile("context/strategy notes/README.md")).toBe(
      "# Committed",
    );
    expect(git(repo.repoDir, "log", "-1", "--format=%s")).toBe("by hand");
  });

  it("brings in GitHub's newer commits to other files before pushing", async () => {
    const repo = createPushedRepo();
    repo.pushFromElsewhere("elsewhere.md", "# Elsewhere\n");
    fs.writeFileSync(repo.filePath, "# Local\n");

    const status = await createGitHubFiles().commitAndPush(repo.filePath);

    expect(status).toMatchObject({ sync: "synced", ahead: 0, behind: 0 });
    expect(repo.remoteFile("context/strategy notes/README.md")).toBe("# Local");
    expect(repo.remoteFile("elsewhere.md")).toBe("# Elsewhere");
    expect(fs.existsSync(path.join(repo.repoDir, "elsewhere.md"))).toBe(true);
  });

  it("keeps the commit and explains when GitHub's commits clash with it", async () => {
    const repo = createPushedRepo();
    repo.pushFromElsewhere("context/strategy notes/README.md", "# Theirs\n");
    fs.writeFileSync(repo.filePath, "# Mine\n");

    await expect(
      createGitHubFiles().commitAndPush(repo.filePath),
    ).rejects.toMatchObject({
      status: 409,
      message:
        "Committed, but not pushed. Commits here and on GitHub change the same lines of context/strategy notes/README.md, so Roughdraft can't combine them. See the changes on GitHub, then merge in a terminal.",
      fileStatus: { sync: "diverged", reason: "unpushed", ahead: 1 },
    });
    expect(fs.readFileSync(repo.filePath, "utf8")).toBe("# Mine\n");
    expect(git(repo.repoDir, "status", "--porcelain")).toBe("");
  });

  it("keeps the commit and reports a push that GitHub refuses", async () => {
    const repo = createPushedRepo();
    const hook = path.join(repo.remoteDir, "hooks", "pre-receive");
    fs.writeFileSync(
      hook,
      "#!/bin/sh\necho 'Branch is protected' >&2\nexit 1\n",
      {
        mode: 0o755,
      },
    );
    fs.writeFileSync(repo.filePath, "# Local\n");

    await expect(
      createGitHubFiles().commitAndPush(repo.filePath),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/^Committed, but the push failed\. /),
      fileStatus: { sync: "changed", reason: "unpushed", ahead: 1 },
    });
  });

  it("refuses gitignored files and detached HEADs", async () => {
    const repo = createPushedRepo();
    repo.write(".gitignore", ".context/\n");
    repo.commitAll();
    git(repo.repoDir, "push", "--quiet");
    const planPath = repo.write(".context/plan.md");
    const files = createGitHubFiles();

    await expect(files.commitAndPush(planPath)).rejects.toMatchObject({
      status: 409,
      message: "Git ignores this file, so it can't be pushed.",
    });

    git(repo.repoDir, "switch", "--quiet", "--detach");
    fs.appendFileSync(repo.filePath, "More\n");
    await expect(files.commitAndPush(repo.filePath)).rejects.toMatchObject({
      status: 409,
      message: "Check out a branch before pushing.",
    });
  });
});

const README_PATH = "context/strategy notes/README.md";
const PARAGRAPHS =
  "# One\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n";

/** A pushed repository whose README has three paragraphs. */
function createParagraphRepo() {
  const repo = createRepo();
  const filePath = repo.write(README_PATH, PARAGRAPHS);
  repo.commitAll("init");
  git(repo.repoDir, "push", "--quiet", "--set-upstream", "origin", "main");
  return { ...repo, filePath };
}

describe("changes on GitHub", { timeout: 30_000 }, () => {
  it("notices GitHub's newer version only once origin is fetched", async () => {
    const repo = createParagraphRepo();
    repo.pushFromElsewhere(
      README_PATH,
      PARAGRAPHS.replace("Second", "Second, revised,"),
    );
    const files = createGitHubFiles();

    expect(await files.status(repo.filePath)).toMatchObject({
      sync: "synced",
      checkedAt: null,
    });
    const status = await files.status(repo.filePath, { fetch: true });

    expect(status).toMatchObject({
      sync: "behind",
      reason: null,
      behind: 1,
      remote: { commits: 1, authors: ["Max"] },
    });
    expect(status?.checkedAt).toEqual(expect.any(Number));
    const base = git(repo.repoDir, "rev-parse", "HEAD");
    const head = git(repo.repoDir, "rev-parse", "origin/main");
    expect(status?.remote?.compareUrl).toMatch(
      new RegExp(
        `^https://github.com/HartreeWorks/example-notes/compare/${base}\\.\\.\\.${head}#diff-[0-9a-f]{64}$`,
      ),
    );
    expect(status?.remote?.head).toBe(head);
  });

  it("stays synced when GitHub's new commits leave this file alone", async () => {
    const repo = createParagraphRepo();
    repo.pushFromElsewhere("other.md", "# Other\n");

    expect(
      await createGitHubFiles().status(repo.filePath, { fetch: true }),
    ).toMatchObject({ sync: "synced", behind: 1, remote: null });
  });

  it("reports both sides changing the file as diverged", async () => {
    const repo = createParagraphRepo();
    repo.pushFromElsewhere(
      README_PATH,
      PARAGRAPHS.replace("Third", "Third, revised,"),
    );
    fs.writeFileSync(
      repo.filePath,
      PARAGRAPHS.replace("First", "First, edited here,"),
    );
    const files = createGitHubFiles();

    expect(await files.status(repo.filePath, { fetch: true })).toMatchObject({
      sync: "diverged",
      reason: "uncommitted",
    });
    repo.commitAll("local edit");
    expect(await files.status(repo.filePath)).toMatchObject({
      sync: "diverged",
      reason: "unpushed",
      ahead: 1,
      behind: 1,
    });
  });

  it("fetches a branch at most once per interval", async () => {
    const repo = createParagraphRepo();
    let now = 0;
    const gitCalls = countingGit();
    const files = createGitHubFiles({
      runGit: gitCalls.run,
      now: () => now,
      fetchIntervalMs: 1000,
    });
    const fetches = () =>
      gitCalls.calls.filter((call) => call.startsWith("fetch")).length;

    await files.status(repo.filePath, { fetch: true });
    await files.status(repo.filePath, { fetch: true });
    expect(fetches()).toBe(1);
    now = 1001;
    await files.status(repo.filePath, { fetch: true });
    expect(fetches()).toBe(2);
  });

  it("updates automatically by fast-forwarding when this copy has no changes", async () => {
    const repo = createParagraphRepo();
    const revised = PARAGRAPHS.replace("Second", "Second, revised,");
    repo.pushFromElsewhere(README_PATH, revised);

    const result = await createGitHubFiles().updateFromGitHub(
      repo.filePath,
      "auto",
    );

    expect(result).toMatchObject({
      updated: true,
      status: { sync: "synced", behind: 0 },
      changes: { commits: 1, authors: ["Max"] },
    });
    expect(fs.readFileSync(repo.filePath, "utf8")).toBe(revised);
    expect(git(repo.repoDir, "rev-parse", "HEAD")).toBe(
      git(repo.repoDir, "rev-parse", "origin/main"),
    );
  });

  it("does nothing when there is nothing to update", async () => {
    const repo = createParagraphRepo();

    expect(
      await createGitHubFiles().updateFromGitHub(repo.filePath, "auto"),
    ).toMatchObject({ updated: false, status: { sync: "synced" } });
  });

  it("won't update automatically when the branch has its own commits, but will on request", async () => {
    const repo = createParagraphRepo();
    const revised = PARAGRAPHS.replace("Second", "Second, revised,");
    repo.pushFromElsewhere(README_PATH, revised);
    repo.write("local.md", "# Local\n");
    repo.commitAll("local commit");
    const files = createGitHubFiles();

    await expect(
      files.updateFromGitHub(repo.filePath, "auto"),
    ).rejects.toMatchObject({
      status: 409,
      message:
        "This copy has changes of its own, so it wasn't updated automatically.",
    });
    expect(fs.readFileSync(repo.filePath, "utf8")).toBe(PARAGRAPHS);

    const result = await files.updateFromGitHub(repo.filePath, "manual");
    expect(result).toMatchObject({ updated: true, status: { sync: "synced" } });
    expect(fs.readFileSync(repo.filePath, "utf8")).toBe(revised);
    expect(
      git(repo.repoDir, "log", "-1", "--format=%p").split(" "),
    ).toHaveLength(2);
  });

  it("won't update automatically over uncommitted changes GitHub also made", async () => {
    const repo = createParagraphRepo();
    repo.write("shared.md", "# Shared\n");
    repo.commitAll("shared");
    git(repo.repoDir, "push", "--quiet");
    repo.pushFromElsewhere(README_PATH, PARAGRAPHS.replace("Second", "Two"));
    repo.pushFromElsewhere("shared.md", "# Shared, theirs\n");
    repo.write("shared.md", "# Shared, mine\n");

    await expect(
      createGitHubFiles().updateFromGitHub(repo.filePath, "auto"),
    ).rejects.toMatchObject({
      status: 409,
      message:
        "Uncommitted changes here would be overwritten in shared.md. Commit or discard them, then update.",
    });
    expect(fs.readFileSync(repo.filePath, "utf8")).toBe(PARAGRAPHS);
    expect(fs.readFileSync(path.join(repo.repoDir, "shared.md"), "utf8")).toBe(
      "# Shared, mine\n",
    );
  });

  it("keeps uncommitted edits to other lines when updating on request", async () => {
    const repo = createParagraphRepo();
    repo.pushFromElsewhere(
      README_PATH,
      PARAGRAPHS.replace("Third", "Third, revised,"),
    );
    fs.writeFileSync(
      repo.filePath,
      PARAGRAPHS.replace("First", "First, edited here,"),
    );

    const result = await createGitHubFiles().updateFromGitHub(
      repo.filePath,
      "manual",
    );

    expect(fs.readFileSync(repo.filePath, "utf8")).toBe(
      PARAGRAPHS.replace("First", "First, edited here,").replace(
        "Third",
        "Third, revised,",
      ),
    );
    expect(result).toMatchObject({
      updated: true,
      status: { sync: "changed", reason: "uncommitted", behind: 0 },
    });
    expect(git(repo.repoDir, "stash", "list")).toBe("");
  });

  it("refuses to update when edits here and on GitHub change the same lines", async () => {
    const repo = createParagraphRepo();
    repo.pushFromElsewhere(
      README_PATH,
      PARAGRAPHS.replace("Second", "Second, theirs,"),
    );
    const mine = PARAGRAPHS.replace("Second", "Second, mine,");
    fs.writeFileSync(repo.filePath, mine);
    const headBefore = git(repo.repoDir, "rev-parse", "HEAD");

    await expect(
      createGitHubFiles().updateFromGitHub(repo.filePath, "manual"),
    ).rejects.toMatchObject({
      status: 409,
      message:
        "Your edits and GitHub's change the same lines of context/strategy notes/README.md, so Roughdraft can't combine them. See the changes on GitHub, then edit to match.",
      fileStatus: { sync: "diverged" },
    });
    expect(fs.readFileSync(repo.filePath, "utf8")).toBe(mine);
    expect(git(repo.repoDir, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(repo.repoDir, "stash", "list")).toBe("");
  });

  it("refuses to update when commits here and on GitHub change the same lines", async () => {
    const repo = createParagraphRepo();
    repo.pushFromElsewhere(
      README_PATH,
      PARAGRAPHS.replace("Second", "Second, theirs,"),
    );
    fs.writeFileSync(
      repo.filePath,
      PARAGRAPHS.replace("Second", "Second, mine,"),
    );
    repo.commitAll("mine");
    const headBefore = git(repo.repoDir, "rev-parse", "HEAD");

    await expect(
      createGitHubFiles().updateFromGitHub(repo.filePath, "manual"),
    ).rejects.toMatchObject({
      status: 409,
      message:
        "Commits here and on GitHub change the same lines of context/strategy notes/README.md, so Roughdraft can't combine them. See the changes on GitHub, then merge in a terminal.",
    });
    expect(git(repo.repoDir, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(repo.repoDir, "status", "--porcelain")).toBe("");
  });
});

describe("GitHub link endpoints", { timeout: 30_000 }, () => {
  function app() {
    return createApp({ homeDir: tempDir, staticDirPath: tempDir }).app;
  }

  it("returns the link and sync state, or a null link", async () => {
    const { filePath } = createPushedRepo();
    const loosePath = path.join(tempDir, "loose.md");
    fs.writeFileSync(loosePath, "# Loose\n");

    const linked = await request(app())
      .get("/api/github-link")
      .query({ path: filePath });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ url: README_URL, sync: "synced" });

    const loose = await request(app())
      .get("/api/github-link")
      .query({ path: loosePath });
    expect(loose.body).toEqual({ url: null });
  });

  it("commits and pushes through the API", async () => {
    const repo = createPushedRepo();
    fs.writeFileSync(repo.filePath, "# Via API\n");

    const response = await request(app())
      .post("/api/github-link/commit-and-push")
      .send({ path: repo.filePath });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ url: README_URL, sync: "synced" });
    expect(repo.remoteFile("context/strategy notes/README.md")).toBe(
      "# Via API",
    );
  });

  it("explains a refused push with the file's current status", async () => {
    const repo = createPushedRepo();
    git(repo.repoDir, "switch", "--quiet", "--detach");
    fs.appendFileSync(repo.filePath, "More\n");

    const response = await request(app())
      .post("/api/github-link/commit-and-push")
      .send({ path: repo.filePath });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: "Check out a branch before pushing.",
      status: { sync: "unknown" },
    });
  });

  it("updates from GitHub through the API", async () => {
    const repo = createParagraphRepo();
    repo.pushFromElsewhere(README_PATH, PARAGRAPHS.replace("First", "1st"));

    const checked = await request(app())
      .get("/api/github-link")
      .query({ path: repo.filePath, fetch: "1" });
    expect(checked.body).toMatchObject({ sync: "behind" });

    const response = await request(app())
      .post("/api/github-link/update")
      .send({ path: repo.filePath, mode: "auto" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      updated: true,
      status: { sync: "synced" },
    });
    expect(fs.readFileSync(repo.filePath, "utf8")).toContain("1st");
  });

  it("rejects relative and non-Markdown paths", async () => {
    expect(
      (await request(app()).get("/api/github-link").query({ path: "a.md" }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app())
          .post("/api/github-link/commit-and-push")
          .send({ path: path.join(tempDir, "image.png") })
      ).status,
    ).toBe(404);
  });
});
