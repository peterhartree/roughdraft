import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
  preserveUneditedMarkdown,
} from "../src/critic-markup";
import { createEditorExtensions } from "../src/editor-extensions";

const fixture = fs.readFileSync(
  path.join(
    process.cwd(),
    "test",
    "fixtures",
    "markdown",
    "meeting-notes-roundtrip.md",
  ),
  "utf8",
);

function roundTrip(markdown: string): string {
  const { doc, comments, frontmatter, endmatter } =
    criticMarkdownToEditorState(markdown);
  return editorStateToCriticMarkdown(doc, comments, { frontmatter, endmatter });
}

// Opens the source in the rich-text editor, replaces each text in place as a
// user would, and saves the way the app does.
function editAndSave(
  source: string,
  replacements: Array<[string, string]> = [],
): string {
  const { doc, comments, frontmatter, endmatter } =
    criticMarkdownToEditorState(source);
  const editor = new Editor({
    extensions: createEditorExtensions(""),
    content: doc,
  });

  try {
    for (const [from, to] of replacements) {
      let found: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (found !== null || !node.isText) return;
        const index = node.text?.indexOf(from) ?? -1;
        if (index >= 0) found = pos + index;
      });
      if (found === null) throw new Error(`Text not found: ${from}`);
      editor.view.dispatch(
        editor.state.tr.insertText(to, found, found + from.length),
      );
    }

    const next = editorStateToCriticMarkdown(editor.getJSON(), comments, {
      frontmatter,
      endmatter,
    });
    return preserveUneditedMarkdown(source, next);
  } finally {
    editor.destroy();
  }
}

function replaceAll(
  source: string,
  replacements: Array<[string, string]>,
): string {
  return replacements.reduce((text, [from, to]) => {
    expect(text.split(from)).toHaveLength(2);
    return text.replace(from, to);
  }, source);
}

describe("saving from the rich-text editor", () => {
  it("writes an unedited document back byte for byte", () => {
    expect(editAndSave(fixture)).toBe(fixture);
  });

  it("rewrites only the edited lines", () => {
    const replacements: Array<[string, string]> = [
      ["weekly team meeting (0:11", "fortnightly team meeting (0:11"],
      ["possibly automated", "probably automated"],
      ["Sam checked whether", "Sam asked whether"],
    ];

    expect(editAndSave(fixture, replacements)).toBe(
      replaceAll(fixture, replacements),
    );
  });

  it("keeps lettered lines, bare URLs and relative links on edited lines", () => {
    const replacements: Array<[string, string]> = [
      ["Use chat when blocked", "Use chat whenever blocked"],
      [
        "Schedule the weekly team meeting [id",
        "Book the weekly team meeting [id",
      ],
      ["Alex Rivera (editor)", "Alex Rivera (lead editor)"],
      ["identify who should get", "identify who should have"],
    ];

    expect(editAndSave(fixture, replacements)).toBe(
      replaceAll(fixture, replacements),
    );
  });

  it("writes Markdown constructs as they were written", () => {
    const input = [
      "Intro paragraph.",
      "",
      "***",
      "",
      "A list item lead-in:",
      "a. first lettered line",
      "b. second lettered line",
      "",
      "---",
      "",
      "See https://example.com/a_b and www.example.org, or the [notes](notes/plan.md).",
      "",
      "![Diagram](images/diagram.png)",
      "",
      "Write to someone@example.com.",
      "",
    ].join("\n");

    expect(roundTrip(input)).toBe(input);
  });

  it("still drops links to script URLs", () => {
    const output = roundTrip(
      '[a](javascript:alert(1)) <a href="java&#9;script:alert(1)">c</a>\n',
    );

    expect(output).not.toMatch(/\]\(/);
  });
});
