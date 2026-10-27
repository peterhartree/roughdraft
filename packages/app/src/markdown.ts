import { tables, taskListItems } from "@joplin/turndown-plugin-gfm";
import { detectRoughdraftEndmatter } from "@roughdraft/rfm";
import DOMPurify from "dompurify";
import { Marked, marked, type TokenizerObject } from "marked";
import TurndownService from "turndown";

export const rawMarkdownBlockAttribute = "data-markdown-raw-block";
export const softBreakAttribute = "data-soft-break";
export const thematicBreakAttribute = "data-markdown-hr";
export const codeInfoAttribute = "data-markdown-info";

/**
 * Splits a fence's info string into its language, which the editor keys on,
 * and the rest (for example `live` in ```` ```html live ````), which only needs
 * to survive a save.
 */
export function splitCodeInfo(info: string | undefined): {
  language: string | null;
  meta: string | null;
} {
  const match = /^\s*(\S+)(?:\s+(.*?))?\s*$/.exec(info ?? "");
  return { language: match?.[1] ?? null, meta: match?.[2] || null };
}

export function codeBlockOpeningHtml(info: string | undefined): string {
  const { language, meta } = splitCodeInfo(info);
  const metaAttr = meta ? ` ${codeInfoAttribute}="${escapeHtml(meta)}"` : "";
  const classAttr = language ? ` class="language-${escapeHtml(language)}"` : "";
  return `<pre${metaAttr}><code${classAttr}>`;
}

export function codeFenceInfo(pre: Element): string {
  const code = pre.firstElementChild;
  const language =
    [...(code?.classList ?? [])]
      .find((className) => className.startsWith("language-"))
      ?.slice("language-".length) ?? "";
  const meta = pre.getAttribute(codeInfoAttribute);
  return language && meta ? `${language} ${meta}` : language;
}

export interface MarkdownOptions {
  resolveFileUrl?: (path: string) => string | null;
  resolveLinkUrl?: (path: string) => string | null;
}

export interface YamlFrontmatterSplit {
  frontmatter: string | null;
  body: string;
}

export interface YamlDocumentMetadataSplit {
  frontmatter: string | null;
  body: string;
  endmatter: string | null;
}

function isExternalUrl(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//");
}

function isInPageAnchor(path: string): boolean {
  return path.startsWith("#");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function encodeRawMarkdownBlock(markdown: string): string {
  return encodeURIComponent(markdown);
}

export function decodeRawMarkdownBlock(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function createRawMarkdownBlock(markdown: string): string {
  return `<div ${rawMarkdownBlockAttribute}="${escapeHtml(
    encodeRawMarkdownBlock(markdown),
  )}"></div>\n`;
}

const svgOpeningPattern = /^\s*<svg\b/i;

function isOwnRawMarkdownBlock(raw: string): boolean {
  return raw.trimStart().startsWith(`<div ${rawMarkdownBlockAttribute}=`);
}

// Any other block-level HTML (a <div>, a sized <img>) has no editor node, so
// the editor would flatten it to its text and an edit would save it as
// Markdown. Keep each block whole, as a read-only preview. An <svg> counts as
// a block from its opening line to the line holding </svg>, though Markdown
// sees a one-line SVG as a paragraph and splits one at blank lines. Markdown
// between an opening and closing tag, set off by blank lines, stays editable.
function protectHtmlBlockTokens(markdown: string): string {
  const tokens = new Marked({ gfm: true }).lexer(markdown);
  let output = "";
  let copied = 0;
  let searchFrom = 0;

  for (const token of tokens) {
    // The lexer normalises line endings, so locate each token in the source
    // and leave any token it can't find exactly as it was.
    const start = markdown.indexOf(token.raw, searchFrom);
    if (start === -1) continue;
    searchFrom = start + token.raw.length;
    if (start < copied) continue;

    let end: number | null = null;
    if (
      (token.type === "html" || token.type === "paragraph") &&
      svgOpeningPattern.test(token.raw)
    ) {
      const close = markdown.toLowerCase().indexOf("</svg>", start);
      if (close !== -1) {
        const lineEnd = markdown.indexOf("\n", close);
        end = lineEnd === -1 ? markdown.length : lineEnd + 1;
      }
    } else if (
      token.type === "html" &&
      token.block &&
      !isOwnRawMarkdownBlock(token.raw)
    ) {
      end = searchFrom;
    }

    if (end === null) continue;

    // Blank lines after the block stay outside the placeholder: the
    // placeholder is itself HTML, which would swallow a following paragraph.
    const raw = markdown.slice(start, end);
    const block = raw.replace(/(?:\r?\n)+$/, "");
    output +=
      markdown.slice(copied, start) +
      createRawMarkdownBlock(block) +
      raw.slice(block.length).replace(/^\r?\n/, "");
    copied = end;
  }

  return output + markdown.slice(copied);
}

function protectRawHtmlBlocks(markdown: string): string {
  return protectHtmlBlockTokens(
    markdown
      .replace(
        /^[ \t]*<details\b[\s\S]*?<\/details>[ \t]*(?:\r?\n|$)/gim,
        (raw) => createRawMarkdownBlock(raw),
      )
      .replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*(?:\r?\n|$)/gm, (raw) =>
        createRawMarkdownBlock(raw),
      ),
  );
}

function indentWidth(whitespace: string): number {
  let width = 0;
  for (const char of whitespace) {
    width = char === "\t" ? width + 4 - (width % 4) : width + 1;
  }
  return width;
}

// An indented block after a list item is code only when it sits four columns
// past the item's content column ("- " is 2, "10. " is 4). Shallower lines are
// continuation paragraphs, which stay editable.
function protectIndentedCodeAfterLists(markdown: string): string {
  return markdown.replace(
    /^((?:[-*+]|\d+[.)])( +))[^\r\n]*(?:\r?\n)[ \t]*(?:\r?\n)(?=([ \t]*))(?:(?: {4}|\t)[^\r\n]*(?:\r?\n|$))+/gm,
    (raw, prefix: string, spacing: string, indent: string) => {
      const contentColumn =
        spacing.length > 4 ? prefix.length - spacing.length + 1 : prefix.length;
      return indentWidth(indent) >= contentColumn + 4
        ? createRawMarkdownBlock(raw)
        : raw;
    },
  );
}

function codeSpanContainsPipe(value: string): boolean {
  const fences = Array.from(value.matchAll(/`+/g), (match) => ({
    start: match.index,
    length: match[0].length,
  }));

  for (let openingIndex = 0; openingIndex < fences.length; openingIndex += 1) {
    const opening = fences[openingIndex];
    if (!opening) continue;

    for (
      let closingIndex = openingIndex + 1;
      closingIndex < fences.length;
      closingIndex += 1
    ) {
      const closing = fences[closingIndex];
      if (!closing || closing.length !== opening.length) continue;

      if (
        value.slice(opening.start + opening.length, closing.start).includes("|")
      ) {
        return true;
      }

      openingIndex = closingIndex;
      break;
    }
  }

  return false;
}

const pipeTableDividerLinePattern =
  /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function protectPipeSensitiveTables(markdown: string): string {
  const lines = markdown.match(/[^\r\n]*(?:\r?\n|$)/g) ?? [];
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";

    if (!line.includes("|") || !pipeTableDividerLinePattern.test(nextLine)) {
      output.push(line);
      continue;
    }

    const tableLines = [line, nextLine];
    index += 2;

    while (index < lines.length) {
      const row = lines[index] ?? "";
      if (!row.trim() || !row.includes("|")) break;
      tableLines.push(row);
      index += 1;
    }

    const raw = tableLines.join("");
    const needsProtection = raw.includes("\\|") || codeSpanContainsPipe(raw);
    output.push(needsProtection ? createRawMarkdownBlock(raw) : raw);
    index -= 1;
  }

  return output.join("");
}

export function protectRichTextRoundTripMarkdown(markdown: string): string {
  return protectPipeSensitiveTables(
    protectIndentedCodeAfterLists(protectRawHtmlBlocks(markdown)),
  );
}

function normalizeMarkdownPath(path: string): string {
  if (path.startsWith("./") || path.startsWith("../")) return path;
  return `./${path.replace(/^\/+/, "")}`;
}

// A bare URL is written back bare only while its text still produces the same
// link: GFM adds "http://" to www. links and "mailto:" to email addresses.
function isLiteralAutolinkText(text: string, href: string): boolean {
  return (
    text === href || `http://${text}` === href || `mailto:${text}` === href
  );
}

function tableHasUnsupportedMarkdownContent(table: HTMLTableElement): boolean {
  return Boolean(
    table.querySelector(
      "blockquote, h1, h2, h3, h4, h5, h6, hr, ol, pre, table, ul",
    ),
  );
}

function getFirstTableRow(table: HTMLTableElement): HTMLTableRowElement | null {
  return table.rows.length > 0 ? table.rows[0] : null;
}

function isHeaderTableRow(row: HTMLTableRowElement | null): boolean {
  if (!row || row.cells.length === 0) return false;

  return Array.from(row.cells).every((cell) => cell.tagName === "TH");
}

function isMarkdownTableDivider(line: string | undefined): boolean {
  return Boolean(line && /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line));
}

function markdownTableDividerForCell(cell: HTMLTableCellElement): string {
  const alignment = (
    cell.getAttribute("align") ||
    cell.style.textAlign ||
    ""
  ).toLowerCase();

  if (alignment === "left") return ":---";
  if (alignment === "right") return "---:";
  if (alignment === "center") return ":---:";

  return "---";
}

function markdownTableDividerForRow(row: HTMLTableRowElement): string {
  const dividers = Array.from(row.cells).map(markdownTableDividerForCell);
  return `|${dividers.join("|")}|`;
}

// Agent-written tables use `|---|---:|` dividers and unpadded cells; the GFM
// plugin pads both, which rewrites every table on save.
function compactMarkdownTableLine(line: string, index: number): string {
  return index === 1 && isMarkdownTableDivider(line)
    ? line.replace(/\s+/g, "")
    : line.replace(/ {2,}(?=\|)/g, " ");
}

function resolveRenderedUrl(
  path: string,
  resolveFileUrl?: MarkdownOptions["resolveFileUrl"],
) {
  if (isExternalUrl(path) || isInPageAnchor(path)) return path;
  return resolveFileUrl?.(path) ?? path;
}

function isYamlFrontmatterDelimiter(line: string): boolean {
  return /^(?:---|\.\.\.)[ \t]*$/.test(line.replace(/\r$/, ""));
}

export function splitYamlFrontmatter(markdown: string): YamlFrontmatterSplit {
  const openingDelimiter = markdown.match(/^---[ \t]*(?:\r\n|\n)/);
  if (!openingDelimiter) return { frontmatter: null, body: markdown };

  let lineStart = openingDelimiter[0].length;

  while (lineStart < markdown.length) {
    const nextLineBreak = markdown.indexOf("\n", lineStart);
    const lineEnd = nextLineBreak === -1 ? markdown.length : nextLineBreak + 1;
    const line = markdown.slice(
      lineStart,
      nextLineBreak === -1 ? lineEnd : lineEnd - 1,
    );

    if (isYamlFrontmatterDelimiter(line)) {
      let bodyStart = lineEnd;

      while (bodyStart < markdown.length) {
        const blankLineBreak = markdown.indexOf("\n", bodyStart);
        const blankLineEnd =
          blankLineBreak === -1 ? markdown.length : blankLineBreak + 1;
        const blankLine = markdown.slice(
          bodyStart,
          blankLineBreak === -1 ? blankLineEnd : blankLineEnd - 1,
        );

        if (blankLine.replace(/\r$/, "").trim() !== "") break;
        bodyStart = blankLineEnd;
      }

      return {
        frontmatter: markdown.slice(0, bodyStart),
        body: markdown.slice(bodyStart),
      };
    }

    lineStart = lineEnd;
  }

  return { frontmatter: null, body: markdown };
}

export function prependYamlFrontmatter(
  markdown: string,
  frontmatter?: string | null,
): string {
  return frontmatter ? `${frontmatter}${markdown}` : markdown;
}

export function splitYamlDocumentMetadata(
  markdown: string,
): YamlDocumentMetadataSplit {
  const { frontmatter, body } = splitYamlFrontmatter(markdown);
  const detection = detectRoughdraftEndmatter(body, {
    skipFrontmatter: false,
  });
  if (detection.kind !== "review") {
    return { frontmatter, body, endmatter: null };
  }

  return {
    frontmatter,
    body: body.slice(0, detection.offset).replace(/\s*$/, "\n"),
    endmatter: detection.raw.replace(/^\n/, ""),
  };
}

export function appendYamlEndmatter(
  markdown: string,
  endmatter?: string | null,
): string {
  return endmatter
    ? `${markdown.replace(/\s*$/, "\n")}\n${endmatter}`
    : markdown;
}

export function createMarkedRenderer(options?: MarkdownOptions) {
  const renderer = new marked.Renderer();
  const baseRenderer = new marked.Renderer();
  const resolveFileUrl = options?.resolveFileUrl;
  const resolveLinkUrl = options?.resolveLinkUrl;

  renderer.code = ({ text, lang, escaped }) => {
    const content = escaped ? text : escapeHtml(text);

    return `${codeBlockOpeningHtml(lang)}${content}</code></pre>\n`;
  };

  renderer.link = function ({ href, title, tokens, raw }) {
    const rawHref = href || "";
    const renderedHref = resolveRenderedUrl(
      rawHref,
      (path) => resolveLinkUrl?.(path) ?? resolveFileUrl?.(path) ?? null,
    );
    const text = this.parser.parseInline(tokens);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    const markdownSrcAttr = ` data-markdown-src="${escapeHtml(rawHref)}"`;
    // `<url>` autolinks and GFM bare URLs ("literal") keep their source form.
    const autolinkAttr =
      !title && raw?.startsWith("<") && raw.endsWith(">")
        ? ' data-markdown-autolink="true"'
        : raw && !raw.startsWith("[") && !raw.startsWith("<")
          ? ' data-markdown-autolink="literal"'
          : "";
    const externalAttr =
      isExternalUrl(rawHref) && !rawHref.startsWith("mailto:")
        ? ' target="_blank" rel="noreferrer noopener"'
        : "";

    return `<a href="${escapeHtml(renderedHref)}"${titleAttr}${markdownSrcAttr}${autolinkAttr}${externalAttr}>${text}</a>`;
  };

  renderer.image = ({ href, title, text }) => {
    const rawHref = href || "";
    const renderedHref = resolveRenderedUrl(rawHref, resolveFileUrl);
    const alt = text || "";
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    const markdownSrcAttr = ` data-markdown-src="${escapeHtml(rawHref)}"`;

    return `<img src="${escapeHtml(renderedHref)}" alt="${escapeHtml(alt)}"${titleAttr}${markdownSrcAttr}>`;
  };

  // Soft line breaks are content in Markdown source (lettered lines under a
  // list item, hard-wrapped prose); keep them as breaks so saving rewrites
  // neither the line structure nor the indentation.
  renderer.text = function (token) {
    const html = baseRenderer.text.call(this, token);
    return "tokens" in token && token.tokens
      ? html
      : html.replace(/\n/g, `<br ${softBreakAttribute}="true">`);
  };

  renderer.hr = ({ raw }) =>
    `<hr ${thematicBreakAttribute}="${escapeHtml(raw.trim())}">\n`;

  renderer.list = function (token) {
    const hasTaskItems = token.items.some((item) => item.task);
    if (!hasTaskItems) {
      return baseRenderer.list.call(this, token);
    }

    const items = token.items
      .map((item) => {
        const checked = item.checked ? "true" : "false";
        const inner = this.parser.parse(item.tokens, false);
        return `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${
          item.checked ? ' checked="checked"' : ""
        }><span></span></label><div>${inner}</div></li>`;
      })
      .join("");

    return `<ul data-type="taskList">${items}</ul>`;
  };

  return renderer;
}

export interface RawMarkdownBlockPreview {
  html: string;
  hasTable: boolean;
}

function sanitizePreviewHtml(
  html: string,
  resolveFileUrl?: MarkdownOptions["resolveFileUrl"],
): RawMarkdownBlockPreview {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    FORBID_TAGS: ["form", "style"],
    ADD_ATTR: ["target"],
  });
  const doc = new DOMParser().parseFromString(sanitized, "text/html");

  // Raw HTML never passes through the Markdown image renderer, so resolve
  // relative image paths here, beside the document, as Markdown images are.
  for (const image of doc.body.querySelectorAll("img[src]")) {
    const src = image.getAttribute("src") ?? "";
    if (!image.hasAttribute("data-markdown-src")) {
      image.setAttribute("src", resolveRenderedUrl(src, resolveFileUrl));
    }
  }

  return {
    html: doc.body.innerHTML,
    hasTable: Boolean(doc.body.querySelector("table")),
  };
}

function escapePipesInsideCodeSpans(value: string): string {
  return value.replace(
    /(`+)([^`]+)\1/g,
    (_match, fence: string, content: string) =>
      `${fence}${content.replace(/(?<!\\)\|/g, "\\|")}${fence}`,
  );
}

export function renderRawMarkdownBlockPreview(
  encoded: string,
  options?: MarkdownOptions,
): RawMarkdownBlockPreview | null {
  const raw = decodeRawMarkdownBlock(encoded);
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("<!--")) return null;

  // An SVG is markup throughout; parsing it as Markdown would split it at
  // blank lines.
  if (svgOpeningPattern.test(raw)) {
    return sanitizePreviewHtml(raw, options?.resolveFileUrl);
  }

  // Pipe tables are protected precisely because GFM would split cells on
  // pipes inside code spans; escape them so the preview keeps cells whole.
  const lines = raw.split(/\r?\n/);
  const isPipeTable = pipeTableDividerLinePattern.test(lines[1] ?? "");
  const source = isPipeTable ? escapePipesInsideCodeSpans(raw) : raw;

  const parser = new Marked({
    gfm: true,
    async: false,
    renderer: createMarkedRenderer(options),
  });
  return sanitizePreviewHtml(
    parser.parse(source) as string,
    options?.resolveFileUrl,
  );
}

const doubleTildeDelPattern =
  /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;

export const markedTokenizer: TokenizerObject = {
  del(src) {
    const match = doubleTildeDelPattern.exec(src);
    if (!match) return undefined;

    const text = match[2] ?? "";
    return {
      type: "del",
      raw: match[0],
      text,
      tokens: this.lexer.inlineTokens(text),
    };
  },
};

export function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    blankReplacement(_content, node) {
      if (node.hasAttribute(rawMarkdownBlockAttribute)) {
        return `\n\n${decodeRawMarkdownBlock(
          node.getAttribute(rawMarkdownBlockAttribute) ?? "",
        ).trimEnd()}\n\n`;
      }

      return (node as HTMLElement & { isBlock?: boolean }).isBlock
        ? "\n\n"
        : "";
    },
  });

  service.addRule("softBreak", {
    filter: (node) =>
      node.nodeName === "BR" &&
      (node as HTMLElement).getAttribute(softBreakAttribute) === "true",
    replacement: () => "\n",
  });

  // Turndown's own rule keeps only the language from a fence's info string.
  service.addRule("fencedCodeBlockInfo", {
    filter: (node) =>
      node.nodeName === "PRE" && node.firstElementChild?.nodeName === "CODE",
    replacement(_content, node) {
      const code = (node as HTMLElement).firstElementChild?.textContent ?? "";
      const longestRun = Math.max(
        2,
        ...Array.from(code.matchAll(/^`{3,}/gm), (match) => match[0].length),
      );
      const fence = "`".repeat(longestRun + 1);
      return `\n\n${fence}${codeFenceInfo(node as HTMLElement)}\n${code.replace(/\n$/, "")}\n${fence}\n\n`;
    },
  });

  service.addRule("thematicBreak", {
    filter: "hr",
    replacement(_content, node) {
      const marker = (node as HTMLElement).getAttribute(thematicBreakAttribute);
      return `\n\n${marker && /^([-*_])(?:[ \t]*\1){2,}$/.test(marker) ? marker : "* * *"}\n\n`;
    },
  });

  service.use(tables as Parameters<TurndownService["use"]>[0]);
  service.use(taskListItems as Parameters<TurndownService["use"]>[0]);

  service.addRule("compactListItem", {
    filter: "li",
    replacement(content, node, options) {
      const normalizedContent =
        (node as HTMLElement).getAttribute("data-type") === "taskItem"
          ? content
              .replace(/^(\[[ xX]\])[ \t]*(?:\r?\n[ \t]*)+(?=\S)/, "$1 ")
              .trimEnd()
          : content;
      let prefix = `${options.bulletListMarker} `;
      const parent = node.parentNode;
      if (parent && parent.nodeName === "OL") {
        const start = (parent as HTMLOListElement).getAttribute("start");
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start ? Number(start) + index : index + 1}. `;
      }

      // Continuation lines must reach the item's content column, which
      // depends on the marker width ("- " is 2, "1. " is 3, "10. " is 4).
      const indent = " ".repeat(prefix.length);
      const trimmed = normalizedContent
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        // Keep a nested list tight against the paragraph that introduces it.
        .replace(/\n{2,}(?=(?:[-*+]|1[.)]) )/g, "\n")
        .replace(/\n(?=[^\n])/g, `\n${indent}`);

      if (!node.nextSibling) return prefix + trimmed;

      // A loose list keeps a blank line between items.
      const loose =
        (parent as HTMLElement | null)?.getAttribute("data-loose") === "true";
      return `${prefix}${trimmed.replace(/\n$/, "")}${loose ? "\n\n" : "\n"}`;
    },
  });

  service.addRule("tiptapHeaderTable", {
    filter(node) {
      if (node.tagName !== "TABLE") return false;

      const table = node as HTMLTableElement;
      return (
        !tableHasUnsupportedMarkdownContent(table) &&
        isHeaderTableRow(getFirstTableRow(table))
      );
    },
    replacement(content, node) {
      const table = node as HTMLTableElement;
      const headerRow = getFirstTableRow(table);
      if (!headerRow) return content;

      const lines = content.replace(/\n+/g, "\n").trim().split("\n");
      if (lines.length === 0) return content;

      if (!isMarkdownTableDivider(lines[1])) {
        lines.splice(1, 0, markdownTableDividerForRow(headerRow));
      }

      const captionContent = table.caption?.textContent || "";
      const caption = captionContent ? `${captionContent}\n\n` : "";

      return `\n\n${caption}${lines.map(compactMarkdownTableLine).join("\n")}\n\n`;
    },
  });

  // We own the markdown parser and want stable round-trips without doubled escapes.
  service.escape = (value: string) => value;

  service.addRule("markdownAwareLinks", {
    filter: "a",
    replacement(content, node) {
      const element = node as HTMLAnchorElement;
      const source = element.getAttribute("data-markdown-src");
      const href = source || element.getAttribute("href") || "";
      const normalizedHref =
        source || isExternalUrl(href) || isInPageAnchor(href)
          ? href
          : normalizeMarkdownPath(href);
      const title = element.getAttribute("title");
      const titleMarkdown = title
        ? ` "${title.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
        : "";

      if (
        element.getAttribute("data-markdown-autolink") === "literal" &&
        !titleMarkdown &&
        isLiteralAutolinkText(content, href) &&
        /^(?:[.,:;!?'")\]]*(?:\s|$))/.test(
          element.nextSibling?.textContent ?? "",
        )
      ) {
        return content;
      }

      if (
        element.getAttribute("data-markdown-autolink") === "true" &&
        !titleMarkdown
      ) {
        return href.startsWith("mailto:")
          ? `<${href.slice("mailto:".length)}>`
          : `<${normalizedHref}>`;
      }

      return `[${content}](${normalizedHref}${titleMarkdown})`;
    },
  });

  service.addRule("markdownAwareImages", {
    filter: "img",
    replacement(_content, node) {
      const element = node as HTMLImageElement;
      const source = element.getAttribute("data-markdown-src");
      const src = source || element.getAttribute("src") || "";
      const normalizedSrc =
        source || isExternalUrl(src) ? src : normalizeMarkdownPath(src);
      const alt = element.getAttribute("alt") || "";
      const title = element.getAttribute("title");
      const titleMarkdown = title
        ? ` "${title.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
        : "";
      return `![${alt}](${normalizedSrc}${titleMarkdown})`;
    },
  });

  service.addRule("markdownStrikethrough", {
    filter: (node) =>
      node.nodeName === "DEL" ||
      node.nodeName === "S" ||
      node.nodeName === "STRIKE",
    replacement(content) {
      return `~~${content}~~`;
    },
  });

  service.addRule("rawMarkdownBlock", {
    filter: (node) =>
      node.nodeType === 1 &&
      (node as HTMLElement).hasAttribute(rawMarkdownBlockAttribute),
    replacement(_content, node) {
      const encoded =
        (node as HTMLElement).getAttribute(rawMarkdownBlockAttribute) ?? "";
      return `\n\n${decodeRawMarkdownBlock(encoded).trimEnd()}\n\n`;
    },
  });

  return service;
}

const turndown = createTurndownService();

const codeFenceOpenPattern = /^\s*(`{3,}|~{3,})/;

/**
 * Collapse runs of blank lines between blocks to a single blank line.
 * Fenced code is left byte-for-byte intact, since blank lines there are
 * content.
 */
export function normalizeBlockSpacing(md: string): string {
  const output: string[] = [];
  let openFence: string | null = null;

  for (const line of md.split("\n")) {
    if (openFence) {
      output.push(line);
      const trimmed = line.trim();
      if (
        trimmed.startsWith(openFence) &&
        trimmed === trimmed[0]?.repeat(trimmed.length)
      ) {
        openFence = null;
      }
      continue;
    }

    openFence = codeFenceOpenPattern.exec(line)?.[1] ?? null;
    if (line === "" && output.at(-1) === "") continue;
    output.push(line);
  }

  return output.join("\n");
}

export function toMarkdown(html: string): string {
  return normalizeBlockSpacing(`${turndown.turndown(html).trimEnd()}\n`);
}

export function toHtml(markdown: string, options?: MarkdownOptions): string {
  const parser = new Marked({
    async: false,
    gfm: true,
    renderer: createMarkedRenderer(options),
  });
  parser.use({ tokenizer: markedTokenizer });

  return parser.parse(markdown) as string;
}
