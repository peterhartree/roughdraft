import { describe, expect, it } from "vitest";
import {
  DOCUMENT_VIEW_STATE_MAX_AGE_MS,
  getRestorableDocumentViewState,
  getRestorableDocumentViewStateForMode,
  type DocumentViewState,
} from "../src/document-view-state";

describe("document view state", () => {
  const capturedAt = new Date("2026-07-20T08:00:00.000Z").getTime();
  const state: DocumentViewState = {
    capturedAt,
    scrollTop: 640,
    editor: { mode: "code", anchor: 120, head: 120 },
  };

  it("keeps a position for exactly 12 hours", () => {
    expect(
      getRestorableDocumentViewState(
        state,
        capturedAt + DOCUMENT_VIEW_STATE_MAX_AGE_MS,
      ),
    ).toEqual(state);
  });

  it("forgets a position immediately after 12 hours", () => {
    expect(
      getRestorableDocumentViewState(
        state,
        capturedAt + DOCUMENT_VIEW_STATE_MAX_AGE_MS + 1,
      ),
    ).toBeNull();
  });

  it("rejects malformed cursor and scroll state", () => {
    expect(
      getRestorableDocumentViewState(
        { ...state, editor: { ...state.editor, anchor: -1 } },
        capturedAt,
      ),
    ).toBeNull();
    expect(
      getRestorableDocumentViewState(
        { ...state, scrollTop: Number.NaN },
        capturedAt,
      ),
    ).toBeNull();
  });

  it("resets state captured in another editor mode", () => {
    expect(
      getRestorableDocumentViewStateForMode(state, "rich-text", capturedAt),
    ).toBeNull();
  });

  it("rejects future capture times after the clock moves backwards", () => {
    expect(getRestorableDocumentViewState(state, capturedAt - 1)).toBeNull();
  });
});
