import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
  preserveUneditedMarkdown,
} from "../src/critic-markup";
import { createEditorExtensions } from "../src/editor-extensions";

type JsonNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
};

function rawBlocks(node: JsonNode): JsonNode[] {
  const own = node.type === "rawMarkdownBlock" ? [node] : [];
  return own.concat((node.content ?? []).flatMap(rawBlocks));
}

// Opens the source in the rich-text editor, optionally replaces a text as a
// user would, and saves the way the app does. `inspect` sees the live editor.
function editAndSave(
  source: string,
  replacements: Array<[string, string]> = [],
  inspect?: (editor: Editor) => void,
): string {
  const { doc, comments, frontmatter, endmatter } =
    criticMarkdownToEditorState(source);
  const editor = new Editor({
    extensions: createEditorExtensions(""),
    content: doc,
  });
  try {
    inspect?.(editor);
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

const div =
  '<div class="callout">\n  <p>Hello <strong>there</strong></p>\n</div>';
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="0" y="20">Inline SVG</text></svg>';
const img = '<img src="assets/a.png" width="300">';

function doc(block: string): string {
  return `Intro paragraph.\n\n${block}\n\nOutro paragraph.\n`;
}

describe("block-level raw HTML in the rich-text editor", () => {
  it("keeps a <details> block as a read-only raw block (control)", () => {
    const details =
      "<details>\n<summary>More</summary>\n\nHidden body.\n\n</details>";
    const source = doc(details);
    const { doc: state } = criticMarkdownToEditorState(source);
    expect(rawBlocks(state as JsonNode)).toHaveLength(1);
    expect(editAndSave(source, [["Outro", "Closing"]])).toBe(
      source.replace("Outro", "Closing"),
    );
  });

  it("parses a <div> block as a raw block holding the original HTML", () => {
    const { doc: state } = criticMarkdownToEditorState(doc(div));
    const blocks = rawBlocks(state as JsonNode);
    expect(blocks).toHaveLength(1);
    const raw = decodeURIComponent(String(blocks[0]?.attrs?.rawMarkdown ?? ""));
    expect(raw.trim()).toBe(div);
  });

  it("does not expose the <div>'s text as editable rich text", () => {
    // Editing "Hello" here and saving currently rewrites the block as
    // "Hi **there**", dropping the div.
    const { doc: state } = criticMarkdownToEditorState(doc(div));
    const editor = new Editor({
      extensions: createEditorExtensions(""),
      content: state,
    });
    try {
      const texts: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.isText) texts.push(node.text ?? "");
      });
      expect(texts.join(" ")).not.toContain("Hello");
    } finally {
      editor.destroy();
    }
  });

  it("keeps a <div> block byte for byte when another paragraph is edited", () => {
    const source = doc(div);
    expect(editAndSave(source, [["Outro", "Closing"]])).toBe(
      source.replace("Outro", "Closing"),
    );
  });

  it("renders an inline <svg> block as a raw block whose preview contains the svg", () => {
    const source = doc(svg);
    editAndSave(source, [], (editor) => {
      const raw = editor.view.dom.querySelector(
        '[data-testid="raw-markdown-block"]',
      );
      expect(raw).not.toBeNull();
      expect(
        editor.view.dom.querySelector('[data-testid="raw-markdown-block"] svg'),
      ).not.toBeNull();
    });
    expect(editAndSave(source, [["Outro", "Closing"]])).toBe(
      source.replace("Outro", "Closing"),
    );
  });

  it("keeps an <img> block's width attribute on save", () => {
    const source = doc(img);
    const { doc: state } = criticMarkdownToEditorState(source);
    expect(rawBlocks(state as JsonNode)).toHaveLength(1);
    expect(editAndSave(source, [["Outro", "Closing"]])).toBe(
      source.replace("Outro", "Closing"),
    );
  });

  it("keeps a multi-line <svg> with blank lines inside as one block", () => {
    const multiLine =
      '<svg viewBox="0 0 100 40">\n  <rect width="100" height="40"/>\n\n  <text x="4" y="20">Label</text>\n</svg>';
    const { doc: state } = criticMarkdownToEditorState(doc(multiLine));
    const blocks = rawBlocks(state as JsonNode);

    expect(blocks).toHaveLength(1);
    expect(
      decodeURIComponent(String(blocks[0]?.attrs?.rawMarkdown ?? "")).trim(),
    ).toBe(multiLine);

    editAndSave(doc(multiLine), [], (editor) => {
      expect(
        editor.view.dom.querySelector(
          '[data-testid="raw-markdown-block"] svg text',
        )?.textContent,
      ).toBe("Label");
    });
  });

  it("leaves HTML inside a code fence as code", () => {
    const fenced = `\`\`\`html\n${svg}\n${div}\n\`\`\``;
    const { doc: state } = criticMarkdownToEditorState(doc(fenced));

    expect(rawBlocks(state as JsonNode)).toHaveLength(0);
  });

  it("resolves relative image paths in the preview beside the document", () => {
    const { doc: state } = criticMarkdownToEditorState(doc(img));
    const editor = new Editor({
      extensions: createEditorExtensions("", {
        resolveFileUrl: (path) => `/api/files?path=${path}`,
      }),
      content: state,
    });
    try {
      expect(
        editor.view.dom
          .querySelector('[data-testid="raw-markdown-block"] img')
          ?.getAttribute("src"),
      ).toBe("/api/files?path=assets/a.png");
    } finally {
      editor.destroy();
    }
  });

  it("keeps Markdown between HTML tags editable, so its comments anchor", () => {
    const wrapped =
      '<div class="callout">\n\n{==Hello==}{>>Tone?<<}{#c1} there\n\n</div>\n\n---\ncomments:\n  c1:\n    by: user\n    at: "2026-10-27T10:00:00.000Z"\n';
    const { doc: state, comments } = criticMarkdownToEditorState(wrapped);

    expect(rawBlocks(state as JsonNode)).toHaveLength(2);
    expect(comments.has("c1")).toBe(true);
    expect(editAndSave(wrapped, [["there", "everyone"]])).toBe(
      wrapped.replace("there", "everyone"),
    );
  });
});
