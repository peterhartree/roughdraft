import { diffArrays } from "diff";

interface Chunk {
  from: number;
  to: number;
  lines: string[];
  changed: boolean;
}

const MAX_EDIT_DISTANCE = 5_000;

function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

// Describes `other` as chunks over the baseline's lines: one unchanged chunk
// per shared line, and one changed chunk per differing run (an empty range
// when `other` only inserts lines).
function chunksAgainst(baseline: string[], other: string[]): Chunk[] | null {
  const changes = diffArrays(baseline, other, {
    maxEditLength: MAX_EDIT_DISTANCE,
  });
  if (!changes) return null;

  const chunks: Chunk[] = [];
  let position = 0;
  let pending: Chunk | null = null;

  for (const change of changes) {
    if (change.removed || change.added) {
      pending ??= { from: position, to: position, lines: [], changed: true };
      if (change.removed) {
        position += change.value.length;
        pending.to = position;
      } else {
        pending.lines.push(...change.value);
      }
      continue;
    }

    if (pending) chunks.push(pending);
    pending = null;
    for (const line of change.value) {
      chunks.push({
        from: position,
        to: position + 1,
        lines: [line],
        changed: false,
      });
      position += 1;
    }
  }
  if (pending) chunks.push(pending);

  return chunks;
}

/**
 * The editor serialises the whole document, so writing its output would
 * rewrite every construct its model cannot represent. `baseline` is the
 * serialiser's output for the unedited `source` and `next` its output after
 * the user's edits. Lines the user did not edit keep their `source` text;
 * edited lines take `next`'s, as does any region the serialiser had already
 * rewritten and the user then edited.
 */
export function mergeEditsIntoSource(
  source: string,
  baseline: string,
  next: string,
): string | null {
  if (next === baseline) return source;

  const baselineLines = splitLines(baseline);
  const sourceChunks = chunksAgainst(baselineLines, splitLines(source));
  const editChunks = chunksAgainst(baselineLines, splitLines(next));
  if (!sourceChunks || !editChunks) return null;

  // A cut is a baseline line boundary that no changed range spans, so both
  // versions can be split there independently.
  const length = baselineLines.length;
  const spanned = new Array<boolean>(length + 1).fill(false);
  for (const chunk of [...sourceChunks, ...editChunks]) {
    for (let position = chunk.from + 1; position < chunk.to; position++) {
      spanned[position] = true;
    }
  }
  const cuts: number[] = [];
  for (let position = 0; position <= length; position++) {
    if (!spanned[position]) cuts.push(position);
  }

  const output: string[] = [];
  let sourceIndex = 0;
  let editIndex = 0;

  for (const [cutIndex, cut] of cuts.entries()) {
    // Lines inserted exactly at the cut. If both versions insert there, the
    // user's edit wins.
    const sourceInserted: string[] = [];
    while (
      sourceChunks[sourceIndex]?.from === cut &&
      sourceChunks[sourceIndex]?.to === cut
    ) {
      sourceInserted.push(...(sourceChunks[sourceIndex]?.lines ?? []));
      sourceIndex++;
    }
    const editInserted: string[] = [];
    let editInserts = false;
    while (
      editChunks[editIndex]?.from === cut &&
      editChunks[editIndex]?.to === cut
    ) {
      editInserts = true;
      editInserted.push(...(editChunks[editIndex]?.lines ?? []));
      editIndex++;
    }
    output.push(...(editInserts ? editInserted : sourceInserted));

    const end = cuts[cutIndex + 1];
    if (end === undefined) break;

    const sourceSegment: Chunk[] = [];
    while ((sourceChunks[sourceIndex]?.from ?? end) < end) {
      sourceSegment.push(sourceChunks[sourceIndex] as Chunk);
      sourceIndex++;
    }
    const editSegment: Chunk[] = [];
    while ((editChunks[editIndex]?.from ?? end) < end) {
      editSegment.push(editChunks[editIndex] as Chunk);
      editIndex++;
    }

    const edited = editSegment.some((chunk) => chunk.changed);
    for (const chunk of edited ? editSegment : sourceSegment) {
      output.push(...chunk.lines);
    }
  }

  return output.join("");
}
