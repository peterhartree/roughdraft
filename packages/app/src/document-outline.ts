/** A heading as it appears in the rendered document, in document order. */
export interface DocumentHeading {
  level: number;
  text: string;
}

export interface DocumentOutlineItem {
  /** Index into the document's heading list, for locating the element. */
  headingIndex: number;
  /** Indent depth, starting at 0 for the outline's top level. */
  depth: number;
  text: string;
  /** The nearest shallower item, shown as context when filtering. */
  parentText: string | null;
}

export type DocumentOutlineMarginLayout =
  | { mode: "pinned"; width: number }
  | { mode: "ticks" };

/** Outlines shorter than this are not worth the margin. */
export const MIN_DOCUMENT_OUTLINE_ITEMS = 3;
const MAX_OUTLINE_DEPTH = 2;
const PINNED_OUTLINE_MAX_WIDTH = 256;
const PINNED_OUTLINE_MIN_WIDTH = 200;
const PINNED_OUTLINE_WIDEST = 320;
const PINNED_OUTLINE_WIDENING_MARGIN = 480;
/** Space kept between the pinned outline and the text, and the window edge. */
const PINNED_OUTLINE_GUTTER = 40;

/**
 * Builds the outline for a document's headings. A single leading H1 is the
 * document title, so it is left out. Depth follows the distinct heading levels
 * that remain, so a document of H2s and H3s indents like one of H1s and H2s.
 */
export function buildDocumentOutline(
  headings: DocumentHeading[],
): DocumentOutlineItem[] {
  const titleIndex =
    headings[0]?.level === 1 &&
    headings.filter((heading) => heading.level === 1).length === 1
      ? 0
      : -1;
  const entries = headings
    .map((heading, headingIndex) => ({ ...heading, headingIndex }))
    .filter(
      (heading) =>
        heading.headingIndex !== titleIndex && heading.text.trim() !== "",
    );
  const levels = [...new Set(entries.map((entry) => entry.level))].sort(
    (a, b) => a - b,
  );
  const ancestors: DocumentOutlineItem[] = [];

  return entries.map((entry) => {
    const depth = Math.min(levels.indexOf(entry.level), MAX_OUTLINE_DEPTH);
    while (
      ancestors.length > 0 &&
      ancestors[ancestors.length - 1].depth >= depth
    ) {
      ancestors.pop();
    }
    const item: DocumentOutlineItem = {
      headingIndex: entry.headingIndex,
      depth,
      text: entry.text.trim().replace(/\s+/g, " "),
      parentText: ancestors[ancestors.length - 1]?.text ?? null,
    };
    ancestors.push(item);
    return item;
  });
}

/**
 * The item for the section being read: the last heading whose top has passed
 * the reading line. Before the first heading, nothing is active.
 */
export function getActiveOutlineItemIndex(
  headingTops: number[],
  readingLine: number,
) {
  let active = -1;
  for (const [index, top] of headingTops.entries()) {
    if (top > readingLine) break;
    active = index;
  }
  return active;
}

/**
 * Whether the margin left of the text column fits the full outline, or only
 * the compact ticks. `availableWidth` runs from the scroller's left edge to the
 * start of the text column.
 */
export function getDocumentOutlineMarginLayout(
  availableWidth: number,
): DocumentOutlineMarginLayout {
  // Past a comfortable margin the outline widens by a quarter of the extra
  // room, so long headings wrap less while most of it stays as space between
  // the outline and the text.
  const width = Math.min(
    PINNED_OUTLINE_WIDEST,
    Math.floor(availableWidth - PINNED_OUTLINE_GUTTER),
    PINNED_OUTLINE_MAX_WIDTH +
      Math.max(
        0,
        Math.floor((availableWidth - PINNED_OUTLINE_WIDENING_MARGIN) / 4),
      ),
  );
  return width >= PINNED_OUTLINE_MIN_WIDTH
    ? { mode: "pinned", width }
    : { mode: "ticks" };
}

/** Outline items matching a palette query, by heading or parent heading. */
export function filterDocumentOutline(
  items: DocumentOutlineItem[],
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return items;
  return items.filter(
    (item) =>
      item.text.toLocaleLowerCase().includes(normalizedQuery) ||
      item.parentText?.toLocaleLowerCase().includes(normalizedQuery),
  );
}

interface OutlineShortcutEvent {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

/** Command+Shift+O (Ctrl+Shift+O elsewhere) opens "Go to heading". */
export function isDocumentOutlinePaletteShortcut(event: OutlineShortcutEvent) {
  return (
    event.code === "KeyO" &&
    event.metaKey !== event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.repeat &&
    !event.isComposing
  );
}

const DOCUMENT_OUTLINE_PREFERENCES_KEY = "roughdraft.document-outline.v1";

type PreferencesStorage = Pick<Storage, "getItem" | "setItem">;

/** Whether the person collapsed the pinned outline to ticks. */
export function readDocumentOutlineCollapsed(
  storage: PreferencesStorage | null = getLocalStorage(),
) {
  try {
    const stored = storage?.getItem(DOCUMENT_OUTLINE_PREFERENCES_KEY);
    if (!stored) return false;
    return (JSON.parse(stored) as { collapsed?: unknown }).collapsed === true;
  } catch {
    return false;
  }
}

export function writeDocumentOutlineCollapsed(
  collapsed: boolean,
  storage: PreferencesStorage | null = getLocalStorage(),
) {
  try {
    storage?.setItem(
      DOCUMENT_OUTLINE_PREFERENCES_KEY,
      JSON.stringify({ collapsed }),
    );
  } catch {
    // Storage can be unavailable; the choice then lasts for this session only.
  }
}

function getLocalStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
