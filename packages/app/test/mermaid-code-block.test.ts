import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
} from "../src/critic-markup";
import { createEditorExtensions } from "../src/editor-extensions";

// Mermaid needs real layout, which jsdom lacks; the stub draws the source it
// is given so the tests can see which version the diagram shows.
const renderMermaid = vi.hoisted(() =>
  vi.fn(async (source: string) =>
    source.includes("BROKEN")
      ? { ok: false as const, error: "Parse error on line 2" }
      : { ok: true as const, svg: `<svg><text>${source}</text></svg>` },
  ),
);

vi.mock("../src/mermaid-render", () => ({
  currentMermaidTheme: () => "light",
  renderMermaid,
}));

const substitution =
  '{~~Draft~>Final~~}{id="s1" by="AI" at="2026-10-27T10:00:00.000Z"}';

function openEditor(markdown: string): Editor {
  const { doc } = criticMarkdownToEditorState(markdown);
  return new Editor({ extensions: createEditorExtensions(""), content: doc });
}

function drawnSource(editor: Editor): string | null {
  return (
    editor.view.dom.querySelector('[data-testid="mermaid-diagram"] text')
      ?.textContent ?? null
  );
}

function block(editor: Editor): HTMLElement {
  const element = editor.view.dom.querySelector<HTMLElement>(
    '[data-testid="mermaid-block"]',
  );
  if (!element) throw new Error("No Mermaid block rendered");
  return element;
}

function testId(editor: Editor, id: string): HTMLElement {
  const element = editor.view.dom.querySelector<HTMLElement>(
    `[data-testid="${id}"]`,
  );
  if (!element) throw new Error(`Missing ${id}`);
  return element;
}

describe("Mermaid fences", () => {
  let editor: Editor | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    renderMermaid.mockClear();
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    vi.useRealTimers();
  });

  it("draws the diagram with its source folded away", async () => {
    editor = openEditor("```mermaid\nflowchart LR\n  A --> B\n```\n");
    await vi.runAllTimersAsync();

    expect(drawnSource(editor)).toBe("flowchart LR\n  A --> B");
    expect(block(editor).hasAttribute("data-source-open")).toBe(false);
    expect(
      testId(editor, "mermaid-source-toggle").getAttribute("aria-expanded"),
    ).toBe("false");

    testId(editor, "mermaid-source-toggle").click();
    expect(block(editor).hasAttribute("data-source-open")).toBe(true);
  });

  it("opens the source by itself when it carries a comment", async () => {
    editor = openEditor(
      '```mermaid\nflowchart LR\n  A[{==Start==}{>>Rename?<<}{#c1}] --> B\n```\n\n---\ncomments:\n  c1:\n    by: user\n    at: "2026-10-27T10:00:00.000Z"\n',
    );
    await vi.runAllTimersAsync();

    expect(block(editor).hasAttribute("data-source-open")).toBe(true);
    expect(drawnSource(editor)).toBe("flowchart LR\n  A[Start] --> B");
  });

  it("shows the suggested version, with a toggle to the original", async () => {
    editor = openEditor(
      `\`\`\`mermaid\nflowchart LR\n  A[${substitution}] --> B\n\`\`\`\n`,
    );
    await vi.runAllTimersAsync();

    expect(block(editor).hasAttribute("data-source-open")).toBe(true);
    expect(drawnSource(editor)).toBe("flowchart LR\n  A[Final] --> B");
    expect(testId(editor, "mermaid-pending-note").hidden).toBe(false);

    testId(editor, "mermaid-version-toggle").click();
    await vi.runAllTimersAsync();
    expect(drawnSource(editor)).toBe("flowchart LR\n  A[Draft] --> B");
  });

  it("reads a suggestion made in the editor before it is saved", async () => {
    editor = openEditor("```mermaid\nflowchart LR\n  A --> B --> C\n```\n");
    await vi.runAllTimersAsync();

    const from = 1 + "flowchart LR\n  A --> B".length;
    editor
      .chain()
      .setTextSelection({ from, to: from + " --> C".length })
      .setCriticChange({
        kind: "deletion",
        changeId: "s9",
        createdAt: "2026-10-27T10:00:00.000Z",
      })
      .run();
    await vi.runAllTimersAsync();

    expect(drawnSource(editor)).toBe("flowchart LR\n  A --> B");
    testId(editor, "mermaid-version-toggle").click();
    await vi.runAllTimersAsync();
    expect(drawnSource(editor)).toBe("flowchart LR\n  A --> B --> C");
  });

  it("hides the version toggle when nothing is pending", async () => {
    editor = openEditor("```mermaid\nflowchart LR\n  A --> B\n```\n");
    await vi.runAllTimersAsync();

    expect(testId(editor, "mermaid-version-toggle").hidden).toBe(true);
  });

  it("keeps the last diagram and explains the error when the source breaks", async () => {
    editor = openEditor("```mermaid\nflowchart LR\n  A --> B\n```\n");
    await vi.runAllTimersAsync();

    const end = editor.state.doc.firstChild?.nodeSize ?? 0;
    editor.view.dispatch(editor.state.tr.insertText("\n  BROKEN", end - 1));
    await vi.runAllTimersAsync();

    expect(drawnSource(editor)).toBe("flowchart LR\n  A --> B");
    expect(testId(editor, "mermaid-error").hidden).toBe(false);
    expect(testId(editor, "mermaid-error").textContent).toContain(
      "Parse error on line 2",
    );
  });

  it("opens the source when the diagram has never drawn", async () => {
    editor = openEditor("```mermaid\nflowchart LR\n  BROKEN\n```\n");
    await vi.runAllTimersAsync();

    expect(testId(editor, "mermaid-error").hidden).toBe(false);
    expect(block(editor).hasAttribute("data-source-open")).toBe(true);
  });

  it("zooms with Shift-scroll but leaves a plain scroll to the page", async () => {
    editor = openEditor("```mermaid\nflowchart LR\n  A --> B\n```\n");
    await vi.runAllTimersAsync();
    const diagram = testId(editor, "mermaid-diagram");
    const resetZoom = testId(editor, "mermaid-zoom-reset");

    const scroll = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
    diagram.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
    expect(resetZoom.hidden).toBe(true);

    const zoom = new WheelEvent("wheel", {
      deltaY: -100,
      shiftKey: true,
      cancelable: true,
    });
    diagram.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    expect(resetZoom.hidden).toBe(false);

    resetZoom.click();
    expect(resetZoom.hidden).toBe(true);
  });

  it("zooms when macOS reports a Shift-held mouse wheel as horizontal", async () => {
    editor = openEditor("```mermaid\nflowchart LR\n  A --> B\n```\n");
    await vi.runAllTimersAsync();

    testId(editor, "mermaid-diagram").dispatchEvent(
      new WheelEvent("wheel", { deltaX: -100, shiftKey: true }),
    );

    expect(testId(editor, "mermaid-zoom-reset").hidden).toBe(false);
  });

  it("opens the diagram full screen and closes it again", async () => {
    editor = openEditor("```mermaid\nflowchart LR\n  A --> B\n```\n");
    expect(testId(editor, "mermaid-full-screen").hidden).toBe(true);
    await vi.runAllTimersAsync();

    testId(editor, "mermaid-full-screen").click();
    await vi.runAllTimersAsync();
    const viewer = () =>
      document.querySelector<HTMLElement>('[data-testid="mermaid-viewer"]');
    expect(viewer()?.textContent).toContain("flowchart LR");

    document
      .querySelector<HTMLElement>('[data-testid="mermaid-viewer-close"]')
      ?.click();
    await vi.runAllTimersAsync();
    expect(viewer()).toBeNull();
  });

  it("leaves other code blocks as plain code", async () => {
    editor = openEditor("```ts\nconst a = 1;\n```\n");
    await vi.runAllTimersAsync();

    expect(
      editor.view.dom.querySelector('[data-testid="mermaid-block"]'),
    ).toBeNull();
    expect(renderMermaid).not.toHaveBeenCalled();
  });

  it("saves the fence exactly as written", () => {
    const markdown = `\`\`\`mermaid\nflowchart LR\n  A[${substitution}] --> B\n\`\`\`\n`;
    const { doc, comments } = criticMarkdownToEditorState(markdown);

    expect(editorStateToCriticMarkdown(doc, comments)).toBe(markdown);
  });
});
