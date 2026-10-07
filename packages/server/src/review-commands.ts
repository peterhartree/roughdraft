import fs from "node:fs";
import path from "node:path";
import {
  appendRoughdraftReply,
  extractRoughdraftReviewIndex,
  markRoughdraftResolved,
  nextRoughdraftCommentId,
  type RfmReviewItem,
  validateRoughdraftMarkdown,
} from "@roughdraft/rfm";

const USAGE_ERROR = 2;

const REVIEW_COMMANDS = ["comments", "reply", "resolve"] as const;
type ReviewCommand = (typeof REVIEW_COMMANDS)[number];

interface ReviewCommandDependencies {
  cwd: string;
  log: (message: string) => void;
  error: (message: string) => void;
  readStdin: () => Promise<string | null>;
}

interface ReviewCommandOptions {
  help: boolean;
  json: boolean;
  unresolved: boolean;
  to?: string;
  by?: string;
  body?: string;
  summary?: string;
  positionals: string[];
}

const VALUE_FLAGS = {
  comments: [],
  reply: ["--to", "--by", "--body"],
  resolve: ["--summary"],
} as const satisfies Record<ReviewCommand, readonly string[]>;

const USAGE: Record<ReviewCommand, string> = {
  comments: "roughdraft comments <path> [--unresolved] [--json]",
  reply:
    "roughdraft reply <path> --to <id> [--by <label>] [--body <text>] [--json]",
  resolve: "roughdraft resolve <path> <id> [--summary <text>] [--json]",
};

export function isReviewCommand(value: string): value is ReviewCommand {
  return (REVIEW_COMMANDS as readonly string[]).includes(value);
}

export function printReviewCommandHelp(
  command: ReviewCommand,
  log: (message: string) => void,
) {
  log("Usage:");
  log(`  ${USAGE[command]}`);
  log("");

  if (command === "comments") {
    log("Lists review comments, replies and suggestions with their ids,");
    log("anchor text, line numbers and parent ids.");
    log("");
    log("Flags:");
    log("  --unresolved  Hide resolved items");
    log("  --json        Print the review index as JSON");
    return;
  }

  if (command === "reply") {
    log("Adds a reply to a comment or suggestion, in the same format as its");
    log("parent. Reads the reply from --body, or from stdin when --body is");
    log("omitted, so quotes, colons and blank lines need no escaping.");
    log("");
    log("Flags:");
    log("  --to <id>      Parent comment or suggestion id (required)");
    log("  --by <label>   Author label, such as Claude or Codex (default: AI)");
    log("  --body <text>  Reply text");
    log("  --json         Print the new reply id as JSON");
    log("");
    log("Example:");
    log(
      "  printf 'Done: tightened the intro.' | roughdraft reply draft.md --to c1 --by Claude",
    );
    return;
  }

  log("Marks a comment or suggestion as resolved.");
  log("");
  log("Flags:");
  log("  --summary <text>  Short resolution summary");
  log("  --json            Print the result as JSON");
}

export async function runReviewCommand(
  command: ReviewCommand,
  args: string[],
  deps: ReviewCommandDependencies,
  globalJson: boolean,
): Promise<number> {
  let options: ReviewCommandOptions;
  try {
    options = parseReviewCommandOptions(command, args);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : "Invalid usage.");
    deps.error(`Usage: ${USAGE[command]}`);
    return USAGE_ERROR;
  }

  if (options.help) {
    printReviewCommandHelp(command, deps.log);
    return 0;
  }

  const json = globalJson || options.json;
  const expectedPositionals = command === "resolve" ? 2 : 1;
  if (options.positionals.length !== expectedPositionals) {
    deps.error(`Usage: ${USAGE[command]}`);
    return USAGE_ERROR;
  }

  const absolutePath = path.resolve(deps.cwd, options.positionals[0] ?? "");
  const markdown = readMarkdownFile(absolutePath, deps);
  if (markdown === null) return USAGE_ERROR;

  if (command === "comments") {
    return listComments(absolutePath, markdown, options, json, deps);
  }

  if (command === "reply") {
    return addReply(absolutePath, markdown, options, json, deps);
  }

  return resolveItem(absolutePath, markdown, options, json, deps);
}

function parseReviewCommandOptions(
  command: ReviewCommand,
  args: string[],
): ReviewCommandOptions {
  const parsed: ReviewCommandOptions = {
    help: false,
    json: false,
    unresolved: false,
    positionals: [],
  };
  const valueFlags: readonly string[] = VALUE_FLAGS[command];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";

    if (arg === "--") {
      parsed.positionals.push(...args.slice(index + 1));
      break;
    }

    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--unresolved" && command === "comments") {
      parsed.unresolved = true;
      continue;
    }

    const [flag, inlineValue] = arg.startsWith("--")
      ? splitFlag(arg)
      : [arg, undefined];
    if (valueFlags.includes(flag)) {
      let value = inlineValue;
      if (value === undefined) {
        value = args[index + 1];
        index += 1;
      }
      if (value === undefined || value === "") {
        throw new Error(`${flag} requires a value.`);
      }
      setValueFlag(parsed, flag, value);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    parsed.positionals.push(arg);
  }

  return parsed;
}

function splitFlag(arg: string): [string, string | undefined] {
  const equals = arg.indexOf("=");
  return equals === -1
    ? [arg, undefined]
    : [arg.slice(0, equals), arg.slice(equals + 1)];
}

function setValueFlag(
  parsed: ReviewCommandOptions,
  flag: string,
  value: string,
) {
  if (flag === "--to") parsed.to = value;
  if (flag === "--by") parsed.by = value;
  if (flag === "--body") parsed.body = value;
  if (flag === "--summary") parsed.summary = value;
}

function readMarkdownFile(
  absolutePath: string,
  deps: ReviewCommandDependencies,
): string | null {
  if (path.extname(absolutePath).toLowerCase() !== ".md") {
    deps.error(`Not a Markdown file: ${absolutePath}`);
    return null;
  }

  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "";
    deps.error(
      code === "ENOENT"
        ? `Path not found: ${absolutePath}`
        : `Could not read path: ${absolutePath}`,
    );
    return null;
  }
}

function listComments(
  absolutePath: string,
  markdown: string,
  options: ReviewCommandOptions,
  json: boolean,
  deps: ReviewCommandDependencies,
): number {
  const index = extractRoughdraftReviewIndex(markdown);
  const items = options.unresolved
    ? withoutResolvedThreads(index.items)
    : index.items;

  if (json) {
    deps.log(
      JSON.stringify(
        {
          path: absolutePath,
          items,
          summary: index.summary,
          diagnostics: index.diagnostics,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (items.length === 0) {
    deps.log("No review items.");
    return 0;
  }

  const ids = new Set(items.map((item) => item.id));
  const roots = items.filter(
    (item) => !item.parentId || !ids.has(item.parentId),
  );
  const printThread = (item: RfmReviewItem, depth: number) => {
    deps.log(formatItem(item, depth));
    for (const reply of items.filter(
      (candidate) => candidate.parentId === item.id,
    )) {
      printThread(reply, depth + 1);
    }
  };

  for (const root of roots) {
    printThread(root, 0);
  }

  return 0;
}

/** Drops resolved items along with every reply beneath them. */
function withoutResolvedThreads(items: RfmReviewItem[]): RfmReviewItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const isResolved = (
    item: RfmReviewItem,
    seen = new Set<string>(),
  ): boolean => {
    if (item.status === "resolved") return true;
    if (!item.parentId || seen.has(item.id)) return false;
    seen.add(item.id);
    const parent = byId.get(item.parentId);
    return parent ? isResolved(parent, seen) : false;
  };

  return items.filter((item) => !isResolved(item));
}

function formatItem(item: RfmReviewItem, depth: number): string {
  const indent = "  ".repeat(depth);
  const status = item.status === "resolved" ? ", resolved" : "";
  const kind =
    item.kind === "suggestion" ? `suggestion (${item.suggestionKind})` : "";
  const header = [
    item.id,
    kind,
    `by ${item.author ?? "unknown"}`,
    depth === 0 ? `line ${item.line}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const anchor =
    depth === 0 && item.anchorText ? ` on "${oneLine(item.anchorText)}"` : "";
  const text =
    item.kind === "suggestion"
      ? (item.replacementText ?? item.text)
      : item.text;

  return `${indent}${header}${status}${anchor}: ${oneLine(text)}`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function addReply(
  absolutePath: string,
  markdown: string,
  options: ReviewCommandOptions,
  json: boolean,
  deps: ReviewCommandDependencies,
): Promise<number> {
  if (!options.to) {
    deps.error("--to <id> is required.");
    deps.error(`Usage: ${USAGE.reply}`);
    return USAGE_ERROR;
  }

  const body = options.body ?? (await deps.readStdin());
  const message = body?.replace(/\s+$/, "") ?? "";
  if (!message.trim()) {
    deps.error("Provide the reply text with --body or on stdin.");
    return USAGE_ERROR;
  }

  const id = nextRoughdraftCommentId(markdown);
  let updated: string;
  try {
    updated = appendRoughdraftReply(markdown, {
      parentId: options.to,
      message,
      author: options.by ?? "AI",
      id,
    });
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const attached = extractRoughdraftReviewIndex(updated).items.some(
    (item) => item.id === id && item.parentId === options.to,
  );
  if (!attached || addsErrors(markdown, updated)) {
    deps.error(
      `Reply was not written: the result would not validate as a reply to ${options.to}.`,
    );
    return 1;
  }

  await writeAtomically(absolutePath, updated);

  if (json) {
    deps.log(
      JSON.stringify({
        ok: true,
        path: absolutePath,
        id,
        parentId: options.to,
      }),
    );
  } else {
    deps.log(`Added reply ${id} to ${options.to}.`);
  }
  return 0;
}

async function resolveItem(
  absolutePath: string,
  markdown: string,
  options: ReviewCommandOptions,
  json: boolean,
  deps: ReviewCommandDependencies,
): Promise<number> {
  const id = options.positionals[1] ?? "";
  let updated: string;
  try {
    updated = markRoughdraftResolved(markdown, {
      targetId: id,
      summary: options.summary,
    });
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (addsErrors(markdown, updated)) {
    deps.error(`${id} was not resolved: the result would not validate.`);
    return 1;
  }

  await writeAtomically(absolutePath, updated);

  if (json) {
    deps.log(JSON.stringify({ ok: true, path: absolutePath, id }));
  } else {
    deps.log(`Resolved ${id}.`);
  }
  return 0;
}

function addsErrors(before: string, after: string): boolean {
  return (
    validateRoughdraftMarkdown(after).errors.length >
    validateRoughdraftMarkdown(before).errors.length
  );
}

async function writeAtomically(targetPath: string, content: string) {
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tmpPath, content);
  await fs.promises.rename(tmpPath, targetPath);
}

export async function readProcessStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
