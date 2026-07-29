import type { DocumentEditorViewMode } from "./app-navigation";
import type {
  DocumentFindDirection,
  DocumentFindResult,
} from "./document-find";

export const DOCUMENT_VIEW_STATE_MAX_AGE_MS = 12 * 60 * 60 * 1_000;

export type DocumentEditorViewState = {
  mode: DocumentEditorViewMode;
  anchor: number;
  head: number;
};

export interface DocumentViewState {
  capturedAt: number;
  scrollTop: number;
  editor: DocumentEditorViewState;
}

export interface DocumentEditorViewController {
  capture: () => DocumentEditorViewState;
  restore: (state: DocumentEditorViewState | null) => void;
  find: (query: string, direction: DocumentFindDirection) => DocumentFindResult;
  clearFind: () => void;
  getFindResult: () => DocumentFindResult;
}

export interface DocumentViewController {
  path: string | null;
  capture: (capturedAt?: number) => DocumentViewState | null;
}

export interface DocumentViewRestoreRequest {
  id: number;
  path: string;
  state: DocumentViewState | null;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && isNonNegativeFiniteNumber(value);
}

export function getDocumentEditorSelectionForMode(
  state: DocumentEditorViewState | null,
  mode: DocumentEditorViewMode,
  maxPosition: number,
) {
  if (state?.mode !== mode) return null;
  return {
    anchor: Math.min(state.anchor, maxPosition),
    head: Math.min(state.head, maxPosition),
  };
}

export function getRestorableDocumentViewState(
  value: unknown,
  now = Date.now(),
): DocumentViewState | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  const editor = candidate.editor;
  if (!editor || typeof editor !== "object") return null;

  const editorCandidate = editor as Record<string, unknown>;
  if (
    (editorCandidate.mode !== "rich-text" && editorCandidate.mode !== "code") ||
    !isNonNegativeInteger(editorCandidate.anchor) ||
    !isNonNegativeInteger(editorCandidate.head) ||
    !isNonNegativeFiniteNumber(candidate.capturedAt) ||
    !isNonNegativeFiniteNumber(candidate.scrollTop) ||
    candidate.capturedAt > now ||
    now - candidate.capturedAt > DOCUMENT_VIEW_STATE_MAX_AGE_MS
  ) {
    return null;
  }

  return {
    capturedAt: candidate.capturedAt,
    scrollTop: candidate.scrollTop,
    editor: {
      mode: editorCandidate.mode,
      anchor: editorCandidate.anchor,
      head: editorCandidate.head,
    },
  };
}

export function getRestorableDocumentViewStateForMode(
  value: unknown,
  mode: DocumentEditorViewMode,
  now = Date.now(),
) {
  const state = getRestorableDocumentViewState(value, now);
  return state?.editor.mode === mode ? state : null;
}
