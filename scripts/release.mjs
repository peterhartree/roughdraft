#!/usr/bin/env node
// Publishes the version in package.json as a GitHub Release, which the
// installed apps check for. Run after committing and pushing the version
// bump on main. Usage: pnpm release [--notes-file <path>] [--dry-run]
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const notesFileIndex = args.indexOf("--notes-file");
const notesFile = notesFileIndex === -1 ? null : args[notesFileIndex + 1];
const repository = "peterhartree/roughdraft";

function run(command, commandArgs) {
  return execFileSync(command, commandArgs, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const desktopVersion = JSON.parse(
  fs.readFileSync("packages/desktop/package.json", "utf8"),
).version;
const tag = `v${version}`;

if (desktopVersion !== version) {
  fail(
    `packages/desktop/package.json is at ${desktopVersion}, not ${version}.`,
  );
}
if (run("git", ["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") {
  fail("Release from main.");
}
if (run("git", ["status", "--porcelain", "--untracked-files=no"])) {
  fail("Commit or discard local changes first.");
}
run("git", ["fetch", "--quiet", "origin", "main", "--tags"]);
const head = run("git", ["rev-parse", "HEAD"]);
if (head !== run("git", ["rev-parse", "origin/main"])) {
  fail("Push main first: installed apps update to origin/main.");
}
if (run("git", ["tag", "--list", tag])) {
  fail(`${tag} already exists. Bump the version in both package.json files.`);
}

let notes;
if (notesFile) {
  notes = fs.readFileSync(notesFile, "utf8").trim();
} else {
  const previous = run("git", [
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v*",
    "HEAD",
  ]);
  const subjects = run("git", [
    "log",
    "--format=%s",
    `${previous}..HEAD`,
  ]).split("\n");
  const section = (title, type) => {
    const lines = subjects
      .map((subject) => /^(\w+)(?:\([^)]*\))?!?: (.+)$/.exec(subject))
      .filter((match) => match?.[1] === type)
      .map(
        (match) => `- ${match[2].charAt(0).toUpperCase()}${match[2].slice(1)}`,
      );
    return lines.length ? `## ${title}\n\n${lines.join("\n")}` : "";
  };
  notes = [section("New", "feat"), section("Fixed", "fix")]
    .filter(Boolean)
    .join("\n\n");
  if (!notes) notes = "Maintenance changes only.";
}

const createArgs = [
  "release",
  "create",
  tag,
  "--repo",
  repository,
  "--target",
  head,
  "--title",
  `Roughdraft ${version}`,
  "--notes",
  notes,
];

if (dryRun) {
  console.log(`Would create ${tag} at ${head} with these notes:\n\n${notes}`);
} else {
  console.log(run("gh", createArgs));
}
