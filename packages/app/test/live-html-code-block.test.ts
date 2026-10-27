import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
} from "../src/critic-markup";
import { createEditorExtensions } from "../src/editor-extensions";
import { toHtml, toMarkdown } from "../src/markdown";

function openEditor(markdown: string): Editor {
  const { doc } = criticMarkdownToEditorState(markdown);
  const element = document.createElement("div");
  document.body.append(element);
  return new Editor({
    element,
    extensions: createEditorExtensions(""),
    content: doc,
  });
}

function testId(editor: Editor, id: string): HTMLElement {
  const element = editor.view.dom.querySelector<HTMLElement>(
    `[data-testid="${id}"]`,
  );
  if (!element) throw new Error(`Missing ${id}`);
  return element;
}

function frame(editor: Editor): HTMLIFrameElement {
  return testId(editor, "live-html-frame") as HTMLIFrameElement;
}

// Stands in for the frame page: says it is ready, then records what the
// editor posts back.
function handshake(editor: Editor): unknown[] {
  const frameWindow = frame(editor).contentWindow;
  if (!frameWindow) throw new Error("Frame has no window");
  const posted: unknown[] = [];
  vi.spyOn(frameWindow, "postMessage").mockImplementation((message) => {
    posted.push(message);
  });
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "roughdraft-live-html:ready" },
      source: frameWindow,
    }),
  );
  return posted;
}

function editCodeBlock(editor: Editor, text: string) {
  const end = editor.state.doc.firstChild?.nodeSize ?? 0;
  editor.view.dispatch(editor.state.tr.insertText(text, end - 1));
}

describe("fence info strings", () => {
  it("keeps everything after the language when a fence is edited", () => {
    const editor = openEditor('```ts title="a.ts"\nconst a = 1;\n```\n');
    editCodeBlock(editor, "\nconst b = 2;");

    expect(editorStateToCriticMarkdown(editor.getJSON(), new Map())).toBe(
      '```ts title="a.ts"\nconst a = 1;\nconst b = 2;\n```\n',
    );
    editor.destroy();
  });

  it("keeps it in a fence that carries a comment", () => {
    const markdown =
      '```html live\n<p>{==Hi==}{>>Warmer?<<}{#c1}</p>\n```\n\n---\ncomments:\n  c1:\n    by: user\n    at: "2026-10-27T10:00:00.000Z"\n';
    const { doc, comments } = criticMarkdownToEditorState(markdown);

    expect(editorStateToCriticMarkdown(doc, comments)).toBe(markdown);
  });

  it("keeps it through the plain Markdown conversion", () => {
    expect(toMarkdown(toHtml("```html live\n<p>Hi</p>\n```\n"))).toBe(
      "```html live\n<p>Hi</p>\n```\n",
    );
  });
});

describe("live HTML fences", () => {
  let editor: Editor | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    editor?.destroy();
    editor?.options.element?.remove();
    editor = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs the HTML in a sandboxed frame with its source folded away", async () => {
    editor = openEditor("```html live\n<button>Go</button>\n```\n");
    await vi.runAllTimersAsync();

    expect(frame(editor).getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame(editor).getAttribute("src")).toBe("/api/live-html-frame");
    expect(
      testId(editor, "live-html-block").hasAttribute("data-source-open"),
    ).toBe(false);
    expect(handshake(editor)).toEqual([
      { type: "roughdraft-live-html:render", html: "<button>Go</button>" },
    ]);
  });

  it("sizes the frame to the height it reports", async () => {
    editor = openEditor("```html live\n<p>Tall</p>\n```\n");
    await vi.runAllTimersAsync();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "roughdraft-live-html:height", height: 321.4 },
        source: frame(editor).contentWindow,
      }),
    );
    expect(frame(editor).style.height).toBe("322px");
  });

  it("ignores messages from anywhere but its own frame", async () => {
    editor = openEditor("```html live\n<p>Hi</p>\n```\n");
    await vi.runAllTimersAsync();
    const before = frame(editor).style.height;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "roughdraft-live-html:height", height: 900 },
        source: window,
      }),
    );
    expect(frame(editor).style.height).toBe(before);
  });

  it("runs the suggested version, with a toggle to the original", async () => {
    editor = openEditor(
      '```html live\n<p>{~~Draft~>Final~~}{id="s1" by="AI" at="2026-10-27T10:00:00.000Z"}</p>\n```\n',
    );
    await vi.runAllTimersAsync();

    expect(
      testId(editor, "live-html-block").hasAttribute("data-source-open"),
    ).toBe(true);
    expect(handshake(editor)).toEqual([
      { type: "roughdraft-live-html:render", html: "<p>Final</p>" },
    ]);

    testId(editor, "live-html-version-toggle").click();
    await vi.runAllTimersAsync();
    expect(handshake(editor)).toEqual([
      { type: "roughdraft-live-html:render", html: "<p>Draft</p>" },
    ]);
  });

  it("starts a fresh frame when the source changes", async () => {
    editor = openEditor("```html live\n<p>One</p>\n```\n");
    await vi.runAllTimersAsync();
    const first = frame(editor);

    editCodeBlock(editor, "\n<p>Two</p>");
    await vi.runAllTimersAsync();

    expect(frame(editor)).not.toBe(first);
    expect(handshake(editor)).toEqual([
      {
        type: "roughdraft-live-html:render",
        html: "<p>One</p>\n<p>Two</p>",
      },
    ]);
  });

  it("leaves plain html fences as code", async () => {
    editor = openEditor("```html\n<p>Hi</p>\n```\n");
    await vi.runAllTimersAsync();

    expect(
      editor.view.dom.querySelector('[data-testid="live-html-block"]'),
    ).toBeNull();
  });
});
