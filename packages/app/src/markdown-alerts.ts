import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const markdownAlertTypes = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;

export type MarkdownAlertType = (typeof markdownAlertTypes)[number];

export interface MarkdownAlertMarker {
  type: MarkdownAlertType;
  /** Offset of "[!" within the blockquote's first paragraph. */
  start: number;
  /** Offset just past "]". */
  end: number;
}

const alertMarkerPattern =
  /^(\s*)\[!(note|tip|important|warning|caution)\]\s*$/i;

// Paths from Lucide (ISC): info, lightbulb, message-square-warning,
// triangle-alert, octagon-alert.
const alertIconPaths: Record<MarkdownAlertType, string[]> = {
  note: ["M12 16v-4", "M12 8h.01", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0"],
  tip: [
    "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5",
    "M9 18h6",
    "M10 22h4",
  ],
  important: [
    "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    "M12 7v2",
    "M12 13h.01",
  ],
  warning: [
    "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    "M12 9v4",
    "M12 17h.01",
  ],
  caution: [
    "M12 16h.01",
    "M12 8v4",
    "M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z",
  ],
};

/**
 * GitHub alerts are blockquotes whose first line is only `[!TYPE]`. The
 * marker stays ordinary text in the document, so comments, suggestions and
 * saving treat it like any other blockquote; only its presentation changes.
 */
export function findMarkdownAlertMarker(
  blockquote: ProseMirrorNode,
): MarkdownAlertMarker | null {
  const paragraph = blockquote.firstChild;
  if (paragraph?.type.name !== "paragraph") return null;

  let firstLine = "";
  for (let index = 0; index < paragraph.childCount; index += 1) {
    const child = paragraph.child(index);
    if (child.type.name === "hardBreak") break;
    if (!child.isText) return null;
    firstLine += child.text ?? "";
  }

  const match = alertMarkerPattern.exec(firstLine);
  if (!match) return null;

  const start = match[1]?.length ?? 0;
  const type = match[2]?.toLowerCase() as MarkdownAlertType;
  return { type, start, end: start + type.length + 3 };
}

function createAlertIcon(type: MarkdownAlertType): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "markdown-alert-icon";
  icon.setAttribute("data-testid", "markdown-alert-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.contentEditable = "false";
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${alertIconPaths[
    type
  ]
    .map((path) => `<path d="${path}"/>`)
    .join("")}</svg>`;
  return icon;
}

function createMarkdownAlertDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "blockquote") return true;

    const marker = findMarkdownAlertMarker(node);
    if (marker) {
      // Blockquote and paragraph openings each take one position.
      const markerStart = pos + 2 + marker.start;
      const markerEnd = pos + 2 + marker.end;

      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: `markdown-alert markdown-alert-${marker.type}`,
          "data-markdown-alert": marker.type,
          "data-testid": "markdown-alert",
        }),
        Decoration.widget(markerStart, () => createAlertIcon(marker.type), {
          side: -1,
          ignoreSelection: true,
          key: `markdown-alert-icon-${marker.type}`,
        }),
        Decoration.inline(markerStart, markerStart + 2, {
          class: "markdown-alert-syntax",
        }),
        Decoration.inline(markerStart + 2, markerEnd - 1, {
          class: "markdown-alert-label",
          "data-testid": "markdown-alert-label",
        }),
        Decoration.inline(markerEnd - 1, markerEnd, {
          class: "markdown-alert-syntax",
        }),
      );
    }

    // Alerts nest inside lists and other blockquotes.
    return true;
  });

  return DecorationSet.create(doc, decorations);
}

const markdownAlertsPluginKey = new PluginKey<DecorationSet>("markdownAlerts");

export const MarkdownAlerts = Extension.create({
  name: "markdownAlerts",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: markdownAlertsPluginKey,
        state: {
          init: (_, state) => createMarkdownAlertDecorations(state.doc),
          apply: (tr, decorations) =>
            tr.docChanged
              ? createMarkdownAlertDecorations(tr.doc)
              : decorations,
        },
        props: {
          decorations: (state) => markdownAlertsPluginKey.getState(state),
        },
      }),
    ];
  },
});
