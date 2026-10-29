import { isMap, isScalar, parseDocument } from "yaml";
import { splitYamlFrontmatter } from "./markdown";

/**
 * Freehand notes kept in the document's YAML frontmatter under `notes:`.
 * A note can link the section it was written about as
 * `[§ Heading text](#heading-slug)`.
 */

const NOTES_FRONTMATTER_KEY = "notes";

export type DocumentNotesRead =
  | { status: "ok"; notes: string }
  | { status: "unavailable"; reason: string };

interface FrontmatterParts {
  opening: string;
  inner: string;
  closing: string;
}

function splitFrontmatterParts(frontmatter: string): FrontmatterParts | null {
  const match = frontmatter.match(
    /^(---[ \t]*\r?\n)([\s\S]*?)((?:---|\.\.\.)[ \t]*(?:\r?\n|$)[\s\S]*)$/,
  );
  if (!match) return null;
  // The inner text must end at a line start, so the closing delimiter
  // matched is a whole line.
  if (match[2] && !match[2].endsWith("\n")) return null;
  return { opening: match[1], inner: match[2], closing: match[3] };
}

/** Removes the trailing blank lines a scratchpad accumulates. */
export function normalizeNotes(notes: string): string {
  return notes.replace(/\s+$/, "");
}

export function readDocumentNotes(markdown: string): DocumentNotesRead {
  const { frontmatter } = splitYamlFrontmatter(markdown);
  if (!frontmatter) return { status: "ok", notes: "" };
  const parts = splitFrontmatterParts(frontmatter);
  if (!parts) return { status: "ok", notes: "" };
  const document = parseDocument(parts.inner);
  if (document.errors.length > 0) {
    return {
      status: "unavailable",
      reason: "The frontmatter isn't valid YAML, so notes can't be saved.",
    };
  }
  const value = document.get(NOTES_FRONTMATTER_KEY);
  if (value === undefined || value === null) return { status: "ok", notes: "" };
  if (typeof value !== "string") {
    return {
      status: "unavailable",
      reason: "The frontmatter's notes field isn't text.",
    };
  }
  return { status: "ok", notes: normalizeNotes(value) };
}

function formatNotesEntry(notes: string): string {
  const lines = notes.split("\n");
  const firstText = lines.find((line) => line.trim() !== "") ?? "";
  // A leading space would otherwise be read as the block's indentation.
  const indicator = /^\s/.test(firstText) ? "|2" : "|";
  const body = lines
    .map((line) => (line.trim() === "" ? "" : `  ${line}`))
    .join("\n");
  return `${NOTES_FRONTMATTER_KEY}: ${indicator}\n${body}\n`;
}

/**
 * Sets the frontmatter's `notes` field, leaving every other byte of the
 * frontmatter as written. Empty notes remove the field, and a frontmatter
 * left with nothing in it is removed. Returns the markdown unchanged when the
 * frontmatter cannot be read.
 */
export function writeDocumentNotes(markdown: string, notes: string): string {
  const nextNotes = normalizeNotes(notes);
  const { frontmatter, body } = splitYamlFrontmatter(markdown);

  if (!frontmatter) {
    if (!nextNotes) return markdown;
    return `---\n${formatNotesEntry(nextNotes)}---\n\n${markdown}`;
  }

  const parts = splitFrontmatterParts(frontmatter);
  if (!parts) return markdown;
  const document = parseDocument(parts.inner);
  if (document.errors.length > 0) return markdown;

  const contents = document.contents;
  let start = parts.inner.length;
  let end = parts.inner.length;
  if (isMap(contents)) {
    const pair = contents.items.find(
      (item) => isScalar(item.key) && item.key.value === NOTES_FRONTMATTER_KEY,
    );
    if (pair && isScalar(pair.key) && pair.key.range) {
      const value = pair.value as { range?: [number, number, number] } | null;
      start = pair.key.range[0];
      end = value?.range?.[2] ?? pair.key.range[2];
      const lineEnd = parts.inner.indexOf("\n", end - 1);
      end = lineEnd === -1 ? parts.inner.length : lineEnd + 1;
    }
  } else if (contents !== null) {
    // Frontmatter that is not a map has nowhere to keep notes.
    return markdown;
  }

  const before = parts.inner.slice(0, start);
  const after = parts.inner.slice(end);
  const entry = nextNotes ? formatNotesEntry(nextNotes) : "";
  const separator = before && !before.endsWith("\n") ? "\n" : "";
  const inner = `${before}${separator}${entry}${after}`;

  if (inner.trim() === "") return body;
  return `${parts.opening}${inner}${parts.closing}${body}`;
}

/**
 * Replaces the markdown's frontmatter with another's, so the rich-text
 * editor, which never edits frontmatter, cannot undo a notes change.
 */
export function withFrontmatterOf(markdown: string, source: string): string {
  const { body } = splitYamlFrontmatter(markdown);
  const { frontmatter } = splitYamlFrontmatter(source);
  return frontmatter ? `${frontmatter}${body}` : body;
}

/** GitHub-style heading anchor: lower case, punctuation dropped, spaces to hyphens. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

type NoteLinePart =
  | { type: "text"; text: string }
  | { type: "section"; label: string; slug: string };

const SECTION_LINK_PATTERN = /\[§ ([^\]\n]+)\]\(#([^)\s]+)\)/g;

export function parseNoteLine(line: string): NoteLinePart[] {
  const parts: NoteLinePart[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(SECTION_LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ type: "text", text: line.slice(lastIndex, index) });
    }
    parts.push({ type: "section", label: match[1], slug: match[2] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < line.length) {
    parts.push({ type: "text", text: line.slice(lastIndex) });
  }
  return parts;
}

export function formatSectionLink(label: string, slug: string): string {
  const safeLabel = label.replace(/[[\]\n]/g, "").trim();
  return `[§ ${safeLabel}](#${slug})`;
}
