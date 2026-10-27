import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
} from "../src/critic-markup";
import { createEditorExtensions } from "../src/editor-extensions";

function renderAlerts(markdown: string) {
  const { doc } = criticMarkdownToEditorState(markdown);
  const editor = new Editor({
    extensions: createEditorExtensions(""),
    content: doc,
  });

  try {
    return Array.from(
      editor.view.dom.querySelectorAll('[data-testid="markdown-alert"]'),
      (quote) => ({
        alert: quote.getAttribute("data-markdown-alert"),
        label:
          quote.querySelector('[data-testid="markdown-alert-label"]')
            ?.textContent ?? null,
        hasIcon: Boolean(
          quote.querySelector('[data-testid="markdown-alert-icon"] svg'),
        ),
      }),
    );
  } finally {
    editor.destroy();
  }
}

describe("GitHub alert callouts", () => {
  it.each([
    ["NOTE", "note"],
    ["TIP", "tip"],
    ["IMPORTANT", "important"],
    ["WARNING", "warning"],
    ["CAUTION", "caution"],
  ])("renders > [!%s] as a %s callout", (marker, type) => {
    expect(renderAlerts(`> [!${marker}]\n> Body text.\n`)).toEqual([
      { alert: type, label: marker, hasIcon: true },
    ]);
  });

  it("accepts a lowercase marker and a body that starts a new paragraph", () => {
    expect(renderAlerts("> [!tip]\n>\n> Body text.\n")).toEqual([
      { alert: "tip", label: "tip", hasIcon: true },
    ]);
  });

  it("recognises a marker that carries a comment anchor", () => {
    const markdown = `> {==[!WARNING]==}{>>Too strong?<<}{#c1}\n> Body text.\n\n---\ncomments:\n  c1:\n    by: user\n    at: "2026-10-27T10:00:00.000Z"\n`;

    expect(renderAlerts(markdown)[0]?.alert).toBe("warning");
  });

  it.each([
    ["an unknown type", "> [!FOO]\n> Body text.\n"],
    ["a marker followed by text on its line", "> [!NOTE] Body text.\n"],
    ["a marker that is not first", "> Body text.\n> [!NOTE]\n"],
  ])("leaves a plain blockquote for %s", (_name, markdown) => {
    expect(renderAlerts(markdown)).toEqual([]);
  });

  it("keeps the marker in the saved Markdown", () => {
    const markdown = "> [!IMPORTANT]\n> Decide before Friday.\n";
    const { doc, comments } = criticMarkdownToEditorState(markdown);

    expect(editorStateToCriticMarkdown(doc, comments)).toBe(markdown);
  });
});
