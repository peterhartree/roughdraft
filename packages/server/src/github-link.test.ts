import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGitHubBlobUrl,
  createGitHubLinkResolver,
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

/** A fake git that answers from a table and records each call. */
function scriptedGit(answers: Record<string, string | Error>) {
  const calls: string[] = [];
  const run: GitRunner = async (args) => {
    const key = args.join(" ");
    calls.push(key);
    const answer = answers[key];
    if (answer === undefined || answer instanceof Error) {
      throw answer ?? new Error(`unexpected git ${key}`);
    }
    return answer;
  };
  return { run, calls };
}

describe("createGitHubLinkResolver", () => {
  let tempDir: string;
  let repoDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-github-link-")),
    );
    repoDir = path.join(tempDir, "repo");
    filePath = path.join(repoDir, "docs", "plan.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "# Plan\n");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const branchAnswers = () => ({
    "rev-parse --show-toplevel": repoDir,
    "remote get-url origin": "git@github.com:o/r.git",
    "symbolic-ref --quiet --short HEAD": "main",
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": new Error(
      "no upstream",
    ),
  });

  it("caches the repository lookup so switching files spawns no git", async () => {
    const otherPath = path.join(repoDir, "docs", "other.md");
    fs.writeFileSync(otherPath, "# Other\n");
    const git = scriptedGit(branchAnswers());
    const resolve = createGitHubLinkResolver({ runGit: git.run });

    expect(await resolve(filePath)).toBe(
      "https://github.com/o/r/blob/main/docs/plan.md",
    );
    const callsAfterFirst = git.calls.length;
    expect(await resolve(otherPath)).toBe(
      "https://github.com/o/r/blob/main/docs/other.md",
    );
    expect(git.calls.length).toBe(callsAfterFirst);
  });

  it("reuses the repository lookup for a file in another folder", async () => {
    const otherPath = path.join(repoDir, "notes", "other.md");
    fs.mkdirSync(path.dirname(otherPath));
    fs.writeFileSync(otherPath, "# Other\n");
    const git = scriptedGit(branchAnswers());
    const resolve = createGitHubLinkResolver({ runGit: git.run });

    await resolve(filePath);
    const callsAfterFirst = git.calls.length;
    expect(await resolve(otherPath)).toBe(
      "https://github.com/o/r/blob/main/notes/other.md",
    );
    expect(git.calls.slice(callsAfterFirst)).toEqual([
      "rev-parse --show-toplevel",
    ]);
  });

  it("looks again once the cache entry expires", async () => {
    let now = 0;
    const git = scriptedGit(branchAnswers());
    const resolve = createGitHubLinkResolver({
      runGit: git.run,
      now: () => now,
      ttlMs: 1000,
    });

    await resolve(filePath);
    const callsAfterFirst = git.calls.length;
    now = 1001;
    await resolve(filePath);
    expect(git.calls.length).toBe(callsAfterFirst * 2);
  });

  it("uses the upstream branch name when it lives on origin", async () => {
    const git = scriptedGit({
      ...branchAnswers(),
      "symbolic-ref --quiet --short HEAD": "local-name",
      "rev-parse --abbrev-ref --symbolic-full-name @{upstream}":
        "origin/feature/remote-name",
    });
    const resolve = createGitHubLinkResolver({ runGit: git.run });

    expect(await resolve(filePath)).toBe(
      "https://github.com/o/r/blob/feature/remote-name/docs/plan.md",
    );
  });

  it("falls back to origin's default branch when HEAD is detached", async () => {
    const git = scriptedGit({
      ...branchAnswers(),
      "symbolic-ref --quiet --short HEAD": new Error("detached"),
      "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/trunk",
    });
    const resolve = createGitHubLinkResolver({ runGit: git.run });

    expect(await resolve(filePath)).toBe(
      "https://github.com/o/r/blob/trunk/docs/plan.md",
    );
  });

  it("falls back to the commit when HEAD is detached and origin has no default", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const git = scriptedGit({
      ...branchAnswers(),
      "symbolic-ref --quiet --short HEAD": new Error("detached"),
      "symbolic-ref --quiet --short refs/remotes/origin/HEAD": new Error(
        "missing",
      ),
      "rev-parse --verify --quiet HEAD": sha,
    });
    const resolve = createGitHubLinkResolver({ runGit: git.run });

    expect(await resolve(filePath)).toBe(
      `https://github.com/o/r/blob/${sha}/docs/plan.md`,
    );
  });

  it("returns null without asking for a branch when origin is not GitHub", async () => {
    const git = scriptedGit({
      ...branchAnswers(),
      "remote get-url origin": "git@gitlab.com:o/r.git",
    });
    const resolve = createGitHubLinkResolver({ runGit: git.run });

    expect(await resolve(filePath)).toBeNull();
    expect(git.calls).not.toContain("symbolic-ref --quiet --short HEAD");
  });

  it("returns null when git fails or the file is missing", async () => {
    const git = scriptedGit({});
    const resolve = createGitHubLinkResolver({ runGit: git.run });

    expect(await resolve(filePath)).toBeNull();
    expect(await resolve(path.join(repoDir, "missing.md"))).toBeNull();
  });
});

describe("GET /api/github-link with a real git repository", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-github-link-api-")),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]) {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    }).trim();
  }

  function createRepo(remote?: string) {
    const repoDir = path.join(tempDir, "repo");
    const filePath = path.join(
      repoDir,
      "context",
      "strategy notes",
      "README.md",
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "# Strategy\n");
    git(repoDir, "init", "--quiet", "--initial-branch=main");
    if (remote) git(repoDir, "remote", "add", "origin", remote);
    git(repoDir, "add", ".");
    git(repoDir, "commit", "--quiet", "-m", "init");
    return { repoDir, filePath };
  }

  function lookup(filePath: string) {
    const { app } = createApp({ homeDir: tempDir, staticDirPath: tempDir });
    return request(app).get("/api/github-link").query({ path: filePath });
  }

  it("links a committed file to its blob on the checked-out branch", async () => {
    const { filePath } = createRepo(
      "https://github.com/HartreeWorks/example-notes.git",
    );

    const response = await lookup(filePath);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      url: "https://github.com/HartreeWorks/example-notes/blob/main/context/strategy%20notes/README.md",
    });
  });

  it("follows the current branch and a detached HEAD", async () => {
    const { repoDir, filePath } = createRepo("git@github.com:o/r.git");
    git(repoDir, "switch", "--quiet", "-c", "review/draft");
    expect((await lookup(filePath)).body.url).toBe(
      "https://github.com/o/r/blob/review/draft/context/strategy%20notes/README.md",
    );

    const sha = git(repoDir, "rev-parse", "HEAD");
    git(repoDir, "switch", "--quiet", "--detach");
    expect((await lookup(filePath)).body.url).toBe(
      `https://github.com/o/r/blob/${sha}/context/strategy%20notes/README.md`,
    );
  });

  it("resolves a file reached through a symlinked folder to its repository path", async () => {
    const { repoDir, filePath } = createRepo("git@github.com:o/r.git");
    const linkDir = path.join(tempDir, "linked-repo");
    fs.symlinkSync(repoDir, linkDir);

    const response = await lookup(
      path.join(linkDir, path.relative(repoDir, filePath)),
    );

    expect(response.body.url).toBe(
      "https://github.com/o/r/blob/main/context/strategy%20notes/README.md",
    );
  });

  it("returns no link without an origin remote", async () => {
    const { filePath } = createRepo();
    expect((await lookup(filePath)).body).toEqual({ url: null });
  });

  it("returns no link for a non-GitHub origin", async () => {
    const { filePath } = createRepo("git@gitlab.com:o/r.git");
    expect((await lookup(filePath)).body).toEqual({ url: null });
  });

  it("returns no link outside a git repository", async () => {
    const filePath = path.join(tempDir, "loose.md");
    fs.writeFileSync(filePath, "# Loose\n");
    expect((await lookup(filePath)).body).toEqual({ url: null });
  });

  it("rejects relative and non-Markdown paths", async () => {
    expect((await lookup("notes/plan.md")).status).toBe(400);
    expect((await lookup(path.join(tempDir, "image.png"))).status).toBe(404);
  });
});
