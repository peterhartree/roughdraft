import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createContext } from "react";

/**
 * Asks the editor to mark the passages changed by the next reload of this
 * document, because an update from GitHub is about to rewrite it. Requests
 * older than {@link GITHUB_CHANGE_MARK_WINDOW_MS} are ignored, so an unrelated
 * later reload is never marked.
 */
export interface GitHubChangeMarkRequest {
  requestedAt: number;
}

export const GITHUB_CHANGE_MARK_WINDOW_MS = 20_000;

export const GitHubChangeMarkRequestContext =
  createContext<GitHubChangeMarkRequest | null>(null);

const gitHubChangeMarksKey = new PluginKey<DecorationSet>("gitHubChangeMarks");

// The negative margin and matching padding widen the block leftwards without
// moving its text, leaving room for the bar in the margin.
const CHANGE_MARK_CLASS =
  "-ml-3 rounded-r-[3px] bg-blue-500/[0.07] pl-3 shadow-[inset_3px_0_0_var(--color-blue-600)] dark:bg-blue-400/10 dark:shadow-[inset_3px_0_0_var(--color-blue-400)]";

/** Flags a reload transaction so its changed passages are marked. */
export function markGitHubChanges(transaction: Transaction): Transaction {
  return transaction.setMeta(gitHubChangeMarksKey, true);
}

/** The ranges of the new document that a transaction inserted or replaced. */
function changedRanges(transaction: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  transaction.mapping.maps.forEach((stepMap, index) => {
    const later = transaction.mapping.slice(index + 1);
    stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      ranges.push([later.map(newFrom, -1), later.map(newTo, 1)]);
    });
  });
  return ranges;
}

/** Marks each paragraph, heading or other text block a change touches. */
function changeMarkDecorations(
  doc: ProseMirrorNode,
  ranges: [number, number][],
): DecorationSet {
  const blocks = new Map<number, number>();
  const addBlock = (node: ProseMirrorNode, pos: number) => {
    blocks.set(pos, pos + node.nodeSize);
  };

  for (const [from, to] of ranges) {
    const start = Math.max(0, Math.min(from, doc.content.size));
    const end = Math.max(start, Math.min(to, doc.content.size));
    let found = false;
    doc.nodesBetween(start, end, (node, pos) => {
      if (!node.isTextblock) return true;
      addBlock(node, pos);
      found = true;
      return false;
    });
    if (found) continue;
    // A pure deletion leaves an empty range: mark the block it happened in.
    const $pos = doc.resolve(start);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth);
      if (node.isTextblock) {
        addBlock(node, $pos.before(depth));
        break;
      }
    }
  }

  return DecorationSet.create(
    doc,
    [...blocks].map(([from, to]) =>
      Decoration.node(from, to, {
        class: CHANGE_MARK_CLASS,
        "data-testid": "github-change-mark",
      }),
    ),
  );
}

/**
 * Marks the passages an update from GitHub changed. The marks follow later
 * edits and last until the document is closed or GitHub updates it again.
 */
export const GitHubChangeMarks = Extension.create({
  name: "gitHubChangeMarks",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: gitHubChangeMarksKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (transaction, decorations) => {
            if (transaction.getMeta(gitHubChangeMarksKey)) {
              return changeMarkDecorations(
                transaction.doc,
                changedRanges(transaction),
              );
            }
            return transaction.docChanged
              ? decorations.map(transaction.mapping, transaction.doc)
              : decorations;
          },
        },
        props: {
          decorations: (state) => gitHubChangeMarksKey.getState(state) ?? null,
        },
      }),
    ];
  },
});
