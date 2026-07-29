export type DocumentFindDirection = "reset" | "next" | "previous";

export interface DocumentFindRange {
  from: number;
  to: number;
}

export interface DocumentFindResult {
  activeIndex: number;
  total: number;
}

export const EMPTY_DOCUMENT_FIND_RESULT: DocumentFindResult = {
  activeIndex: -1,
  total: 0,
};

interface FoldedText {
  text: string;
  sourceStarts: number[];
  sourceEnds: number[];
}

function foldTextWithSourceOffsets(text: string): FoldedText {
  let foldedText = "";
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];
  let sourceIndex = 0;

  for (const character of text) {
    const foldedCharacter = character.toLowerCase();
    const sourceEnd = sourceIndex + character.length;
    foldedText += foldedCharacter;
    for (let index = 0; index < foldedCharacter.length; index += 1) {
      sourceStarts.push(sourceIndex);
      sourceEnds.push(sourceEnd);
    }
    sourceIndex = sourceEnd;
  }

  return { text: foldedText, sourceStarts, sourceEnds };
}

function foldText(text: string): string {
  let foldedText = "";
  for (const character of text) foldedText += character.toLowerCase();
  return foldedText;
}

export function findTextRanges(
  text: string,
  query: string,
  offset = 0,
): DocumentFindRange[] {
  if (!query) return [];

  const searchableText = foldTextWithSourceOffsets(text);
  const searchableQuery = foldText(query);
  if (!searchableQuery) return [];
  const ranges: DocumentFindRange[] = [];
  let from = 0;

  while (from <= searchableText.text.length - searchableQuery.length) {
    const index = searchableText.text.indexOf(searchableQuery, from);
    if (index < 0) break;

    const sourceFrom = searchableText.sourceStarts[index];
    const sourceTo =
      searchableText.sourceEnds[index + searchableQuery.length - 1];
    if (sourceFrom === undefined || sourceTo === undefined) break;

    ranges.push({
      from: offset + sourceFrom,
      to: offset + sourceTo,
    });
    from = index + searchableQuery.length;
  }

  return ranges;
}

export function getDocumentFindActiveIndex(
  previousIndex: number,
  total: number,
  direction: DocumentFindDirection,
): number {
  if (total === 0) return -1;
  if (direction === "reset" || previousIndex < 0 || previousIndex >= total) {
    return 0;
  }
  if (direction === "previous") {
    return (previousIndex - 1 + total) % total;
  }
  return (previousIndex + 1) % total;
}
