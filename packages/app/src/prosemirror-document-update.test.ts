import { history, undo } from "@tiptap/pm/history";
import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { createDocumentUpdateTransaction } from "./prosemirror-document-update";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    comment: { attrs: { id: {} } },
  },
});

function document(...paragraphs: string[]): ProseMirrorNode {
  return schema.node(
    "doc",
    null,
    paragraphs.map((text) =>
      schema.node("paragraph", null, text ? schema.text(text) : undefined),
    ),
  );
}

function positionInParagraph(
  doc: ProseMirrorNode,
  paragraph: number,
  offset: number,
) {
  let position = 0;
  for (let index = 0; index < paragraph; index++) {
    position += doc.child(index).nodeSize;
  }
  return position + 1 + offset;
}

function requiredTransaction(transaction: Transaction | null): Transaction {
  expect(transaction).not.toBeNull();
  if (!transaction) throw new Error("Expected a document update transaction");
  return transaction;
}

describe("createDocumentUpdateTransaction", () => {
  it("does nothing when the parsed document is unchanged", () => {
    const doc = document("One", "Two");
    const state = EditorState.create({ schema, doc });

    expect(createDocumentUpdateTransaction(state, doc)).toBeNull();
  });

  it("keeps a selection in an unchanged middle paragraph across disjoint edits", () => {
    const current = document(
      "Original first",
      "Keep this caret",
      "Original last",
    );
    const selectionPosition = positionInParagraph(current, 1, 9);
    const state = EditorState.create({
      schema,
      doc: current,
      selection: TextSelection.create(current, selectionPosition),
    });
    const next = document("Changed first", "Keep this caret", "Changed last");

    const transaction = requiredTransaction(
      createDocumentUpdateTransaction(state, next),
    );
    const updated = state.apply(transaction);

    expect(updated.doc.eq(next)).toBe(true);
    expect(updated.selection.head).toBe(positionInParagraph(updated.doc, 1, 9));
    expect(updated.doc.resolve(updated.selection.head).parent.textContent).toBe(
      "Keep this caret",
    );
  });

  it("keeps a selection between disjoint edits in the same paragraph", () => {
    const current = document(
      "The opening is old. Keep this caret exactly here. The ending is old.",
    );
    const caretOffset = current.textContent.indexOf("exactly") + 3;
    const state = EditorState.create({
      schema,
      doc: current,
      selection: TextSelection.create(current, 1 + caretOffset),
    });
    const next = document(
      "The opening is new. Keep this caret exactly here. The ending is new.",
    );

    const transaction = requiredTransaction(
      createDocumentUpdateTransaction(state, next),
    );
    const updated = state.apply(transaction);

    expect(updated.doc.eq(next)).toBe(true);
    expect(updated.selection.head).toBe(1 + caretOffset);
    expect(
      updated.doc.textBetween(
        updated.selection.head - 3,
        updated.selection.head + 4,
      ),
    ).toBe("exactly");
  });

  it("keeps a selection when a new inline mark splits its text node", () => {
    const current = document("hello world");
    const state = EditorState.create({
      schema,
      doc: current,
      selection: TextSelection.create(current, 1 + "hello wor".length),
    });
    const next = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("hello", [schema.mark("comment", { id: "c1" })]),
        schema.text(" world"),
      ]),
    ]);

    const updated = state.apply(
      requiredTransaction(createDocumentUpdateTransaction(state, next)),
    );

    expect(updated.doc.eq(next)).toBe(true);
    expect(updated.selection.head).toBe(1 + "hello wor".length);
    expect(updated.doc.resolve(updated.selection.head).parent.textContent).toBe(
      "hello world",
    );
  });

  it("maps the selection through content inserted before it", () => {
    const current = document("First", "Selected paragraph");
    const state = EditorState.create({
      schema,
      doc: current,
      selection: TextSelection.create(
        current,
        positionInParagraph(current, 1, 8),
      ),
    });
    const next = document("Inserted", "First", "Selected paragraph");

    const updated = state.apply(
      requiredTransaction(createDocumentUpdateTransaction(state, next)),
    );

    expect(updated.selection.head).toBe(positionInParagraph(updated.doc, 2, 8));
    expect(updated.doc.resolve(updated.selection.head).parent.textContent).toBe(
      "Selected paragraph",
    );
  });

  it("keeps external updates out of undo while rebasing earlier typing", () => {
    const initial = document("Draft", "Tail");
    let state = EditorState.create({
      schema,
      doc: initial,
      plugins: [history()],
    });
    state = state.apply(
      state.tr.insertText(" local", positionInParagraph(state.doc, 0, 5)),
    );
    const external = document("Draft local", "Tail from disk");

    state = state.apply(
      requiredTransaction(createDocumentUpdateTransaction(state, external)),
    );
    let undoTransaction: Transaction | null = null;
    expect(
      undo(state, (transaction) => {
        undoTransaction = transaction;
      }),
    ).toBe(true);
    state = state.apply(requiredTransaction(undoTransaction));

    expect(state.doc.textContent).toBe("DraftTail from disk");
  });
});
