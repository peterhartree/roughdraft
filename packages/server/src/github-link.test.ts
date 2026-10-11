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
// repositories, with a push URL pointing at a local bare repository so that
// pushing never leaves this machine.
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
    git(repoDir, "config", "remote.origin.pushurl", remoteDir);
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
  return { repoDir, remoteDir, write, commitAll, remoteFile };
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

describe("GitHub file status", () => {
  it("links a pushed file to its blob on the checked-out branch", async () => {
    const { filePath } = createPushedRepo();

    expect(await createGitHubFiles().status(filePath)).toEqual({
      url: README_URL,
      sync: "synced",
      reason: null,
      branch: "main",
      ahead: 0,
      uncommitted: false,
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

describe("commit and push", () => {
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

  it("keeps the commit and explains when GitHub has newer commits", async () => {
    const repo = createPushedRepo();
    const otherClone = path.join(tempDir, "other-clone");
    git(tempDir, "clone", "--quiet", repo.remoteDir, otherClone);
    git(otherClone, "config", "user.name", "Other");
    git(otherClone, "config", "user.email", "other@example.com");
    fs.writeFileSync(path.join(otherClone, "elsewhere.md"), "# Elsewhere\n");
    git(otherClone, "add", "elsewhere.md");
    git(otherClone, "commit", "--quiet", "-m", "elsewhere");
    git(otherClone, "push", "--quiet");
    fs.writeFileSync(repo.filePath, "# Local\n");

    const push = createGitHubFiles().commitAndPush(repo.filePath);

    await expect(push).rejects.toMatchObject({
      status: 502,
      message:
        "Committed, but the push failed. GitHub has commits that this copy doesn't. Pull them, then push again.",
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

describe("GitHub link endpoints", () => {
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
