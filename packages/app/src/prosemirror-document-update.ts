import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { diffArrays, diffChars } from "diff";

interface DocumentReplacement {
  from: number;
  to: number;
  content: Fragment;
}

interface ChildMatch {
  current: number;
  next: number;
}

interface InlineToken {
  node: ProseMirrorNode;
  text: string | null;
  from: number;
}

const MAX_EDIT_DISTANCE = 2_000;

function itemAt<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) throw new RangeError(`Missing item at ${index}`);
  return item;
}

function childOffsets(content: Fragment): number[] {
  const offsets = [0];
  let offset = 0;

  content.forEach((node) => {
    offset += node.nodeSize;
    offsets.push(offset);
  });

  return offsets;
}

function matchingChildren(
  current: readonly ProseMirrorNode[],
  next: readonly ProseMirrorNode[],
): ChildMatch[] {
  const changes = diffArrays([...current], [...next], {
    comparator: (currentNode, nextNode) => currentNode.eq(nextNode),
    maxEditLength: MAX_EDIT_DISTANCE,
  });
  if (!changes) return [];

  const matches: ChildMatch[] = [];
  let currentIndex = 0;
  let nextIndex = 0;

  for (const change of changes) {
    if (change.removed) {
      currentIndex += change.value.length;
    } else if (change.added) {
      nextIndex += change.value.length;
    } else {
      for (let offset = 0; offset < change.value.length; offset++) {
        matches.push({
          current: currentIndex + offset,
          next: nextIndex + offset,
        });
      }
      currentIndex += change.value.length;
      nextIndex += change.value.length;
    }
  }

  return matches;
}

function inlineTokens(content: Fragment): InlineToken[] {
  const tokens: InlineToken[] = [];

  content.forEach((node, nodeOffset) => {
    if (!node.isText) {
      tokens.push({ node, text: null, from: nodeOffset });
      return;
    }

    let textOffset = 0;
    for (const character of node.text ?? "") {
      tokens.push({
        node,
        text: character,
        from: nodeOffset + textOffset,
      });
      textOffset += character.length;
    }
  });

  return tokens;
}

function inlineTokenOffset(
  tokens: readonly InlineToken[],
  index: number,
  contentSize: number,
): number {
  return index === tokens.length ? contentSize : itemAt(tokens, index).from;
}

function collectInlineReplacements(
  current: Fragment,
  next: Fragment,
  position: number,
  replacements: DocumentReplacement[],
): void {
  const currentTokens = inlineTokens(current);
  const nextTokens = inlineTokens(next);
  const changes = diffArrays(currentTokens, nextTokens, {
    comparator: (currentToken, nextToken) =>
      currentToken.text === nextToken.text &&
      currentToken.node.sameMarkup(nextToken.node) &&
      (currentToken.text !== null || currentToken.node.eq(nextToken.node)),
    maxEditLength: MAX_EDIT_DISTANCE,
  });

  if (!changes) {
    replacements.push({
      from: position,
      to: position + current.size,
      content: next,
    });
    return;
  }

  let currentIndex = 0;
  let nextIndex = 0;
  let currentGapStart = 0;
  let nextGapStart = 0;

  const flushGap = () => {
    if (currentGapStart === currentIndex && nextGapStart === nextIndex) return;
    const currentFrom = inlineTokenOffset(
      currentTokens,
      currentGapStart,
      current.size,
    );
    const currentTo = inlineTokenOffset(
      currentTokens,
      currentIndex,
      current.size,
    );
    const nextFrom = inlineTokenOffset(nextTokens, nextGapStart, next.size);
    const nextTo = inlineTokenOffset(nextTokens, nextIndex, next.size);
    replacements.push({
      from: position + currentFrom,
      to: position + currentTo,
      content: next.cut(nextFrom, nextTo),
    });
  };

  for (const change of changes) {
    if (change.removed) currentIndex += change.value.length;
    else if (change.added) nextIndex += change.value.length;
    else {
      flushGap();
      currentIndex += change.value.length;
      nextIndex += change.value.length;
      currentGapStart = currentIndex;
      nextGapStart = nextIndex;
    }
  }
  flushGap();
}

function commonTextEdges(current: string, next: string) {
  let prefix = 0;
  while (
    prefix < current.length &&
    prefix < next.length &&
    current.charCodeAt(prefix) === next.charCodeAt(prefix)
  ) {
    prefix++;
  }

  // ProseMirror positions count UTF-16 code units. Keep replacement boundaries
  // outside surrogate pairs so an emoji is never split into invalid text.
  if (
    prefix > 0 &&
    prefix < current.length &&
    prefix < next.length &&
    /[\uD800-\uDBFF]/u.test(current.charAt(prefix - 1))
  ) {
    prefix--;
  }

  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    current.charCodeAt(current.length - suffix - 1) ===
      next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix++;
  }

  if (
    suffix > 0 &&
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    /[\uDC00-\uDFFF]/u.test(current.charAt(current.length - suffix))
  ) {
    suffix--;
  }

  return { prefix, suffix };
}

function textFragment(text: string, nextNode: ProseMirrorNode): Fragment {
  return text
    ? Fragment.from(nextNode.type.schema.text(text, nextNode.marks))
    : Fragment.empty;
}

function collectTextReplacements(
  current: string,
  next: string,
  position: number,
  nextNode: ProseMirrorNode,
  replacements: DocumentReplacement[],
): void {
  const changes = diffChars(current, next, {
    maxEditLength: MAX_EDIT_DISTANCE,
  });

  if (!changes) {
    const { prefix, suffix } = commonTextEdges(current, next);
    replacements.push({
      from: position + prefix,
      to: position + current.length - suffix,
      content: textFragment(next.slice(prefix, next.length - suffix), nextNode),
    });
    return;
  }

  let currentOffset = 0;
  let pendingFrom: number | null = null;
  let pendingTo = 0;
  let insertedText = "";
  const flush = () => {
    if (pendingFrom === null) return;
    replacements.push({
      from: position + pendingFrom,
      to: position + pendingTo,
      content: textFragment(insertedText, nextNode),
    });
    pendingFrom = null;
    insertedText = "";
  };

  for (const change of changes) {
    if (!change.added && !change.removed) {
      flush();
      currentOffset += change.value.length;
    } else if (change.removed) {
      pendingFrom ??= currentOffset;
      currentOffset += change.value.length;
      pendingTo = currentOffset;
    } else {
      pendingFrom ??= currentOffset;
      pendingTo = currentOffset;
      insertedText += change.value;
    }
  }
  flush();
}

function collectNodeReplacements(
  current: ProseMirrorNode,
  next: ProseMirrorNode,
  position: number,
  replacements: DocumentReplacement[],
): void {
  if (current.eq(next)) return;

  if (current.isText && next.isText && current.sameMarkup(next)) {
    collectTextReplacements(
      current.text ?? "",
      next.text ?? "",
      position,
      next,
      replacements,
    );
    return;
  }

  if (current.sameMarkup(next) && !current.isLeaf && !next.isLeaf) {
    collectContentReplacements(
      current.content,
      next.content,
      position + 1,
      replacements,
    );
    return;
  }

  replacements.push({
    from: position,
    to: position + current.nodeSize,
    content: Fragment.from(next),
  });
}

function collectContentReplacements(
  current: Fragment,
  next: Fragment,
  position: number,
  replacements: DocumentReplacement[],
): void {
  if (current.eq(next)) return;

  const hasInlineContent =
    (current.firstChild?.isInline ?? next.firstChild?.isInline ?? false) &&
    current.content.every((node) => node.isInline) &&
    next.content.every((node) => node.isInline);
  if (hasInlineContent) {
    collectInlineReplacements(current, next, position, replacements);
    return;
  }

  const currentChildren = current.content;
  const nextChildren = next.content;
  const currentOffsets = childOffsets(current);
  const nextOffsets = childOffsets(next);
  const matches = matchingChildren(currentChildren, nextChildren);
  let currentIndex = 0;
  let nextIndex = 0;

  const collectGap = (currentEnd: number, nextEnd: number) => {
    const currentLength = currentEnd - currentIndex;
    const nextLength = nextEnd - nextIndex;

    if (
      currentLength === nextLength &&
      currentLength > 0 &&
      Array.from({ length: currentLength }).every((_, offset) =>
        itemAt(currentChildren, currentIndex + offset).sameMarkup(
          itemAt(nextChildren, nextIndex + offset),
        ),
      )
    ) {
      for (let offset = 0; offset < currentLength; offset++) {
        collectNodeReplacements(
          itemAt(currentChildren, currentIndex + offset),
          itemAt(nextChildren, nextIndex + offset),
          position + itemAt(currentOffsets, currentIndex + offset),
          replacements,
        );
      }
    } else if (currentLength > 0 || nextLength > 0) {
      replacements.push({
        from: position + itemAt(currentOffsets, currentIndex),
        to: position + itemAt(currentOffsets, currentEnd),
        content: next.cut(
          itemAt(nextOffsets, nextIndex),
          itemAt(nextOffsets, nextEnd),
        ),
      });
    }

    currentIndex = currentEnd;
    nextIndex = nextEnd;
  };

  for (const match of matches) {
    collectGap(match.current, match.next);
    currentIndex++;
    nextIndex++;
  }
  collectGap(currentChildren.length, nextChildren.length);
}

function mappedTextSelection(
  document: ProseMirrorNode,
  anchor: number,
  head: number,
) {
  return TextSelection.between(
    document.resolve(Math.min(anchor, document.content.size)),
    document.resolve(Math.min(head, document.content.size)),
  );
}

/**
 * Builds a non-historic transaction that changes only the differing document
 * ranges. Unchanged runs stay outside replacement steps, allowing ProseMirror
 * to map the current selection and existing undo history through disk updates.
 */
export function createDocumentUpdateTransaction(
  state: EditorState,
  nextDocument: ProseMirrorNode,
): Transaction | null {
  if (state.doc.eq(nextDocument)) return null;

  const replacements: DocumentReplacement[] = [];
  collectContentReplacements(
    state.doc.content,
    nextDocument.content,
    0,
    replacements,
  );

  const transaction = state.tr;
  for (const replacement of replacements.sort(
    (a, b) => b.from - a.from || b.to - a.to,
  )) {
    transaction.replaceWith(
      replacement.from,
      replacement.to,
      replacement.content,
    );
  }

  if (!transaction.doc.eq(nextDocument)) {
    const mappedAnchor = transaction.selection.anchor;
    const mappedHead = transaction.selection.head;
    const fallback = state.tr.replaceWith(
      0,
      state.doc.content.size,
      nextDocument.content,
    );
    fallback.setSelection(
      mappedTextSelection(fallback.doc, mappedAnchor, mappedHead),
    );
    fallback.setMeta("addToHistory", false);
    fallback.setMeta("preventUpdate", true);
    return fallback;
  }

  transaction.setMeta("addToHistory", false);
  transaction.setMeta("preventUpdate", true);
  return transaction;
}
