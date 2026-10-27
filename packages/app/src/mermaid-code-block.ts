import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { codeSourceVersions } from "./code-source-versions";
import { buttonVariants } from "./components/ui/button";
import {
  currentMermaidTheme,
  type MermaidTheme,
  renderMermaid,
} from "./mermaid-render";

const renderDelayMs = 300;
const toolbarButtonClass = buttonVariants({ variant: "ghost", size: "xs" });

let nextSourceId = 0;

/**
 * A Mermaid fence shows its diagram, with the editable source under a
 * "Source" disclosure. The source stays the node's content, so comments,
 * suggestions and saving work exactly as in any code block. The source opens
 * by itself whenever it carries comments or suggestions; while suggestions
 * are pending the diagram shows the proposed version, with a toggle back to
 * the original.
 */
export class MermaidCodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private node: ProseMirrorNode;
  private diagram: HTMLElement;
  private error: HTMLElement;
  private sourceToggle: HTMLButtonElement;
  private versionToggle: HTMLButtonElement;
  private pendingNote: HTMLElement;
  private sourceOpen = false;
  private showOriginal = false;
  private hadReview = false;
  private renderedKey: string | null = null;
  private renderToken = 0;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private themeObserver: MutationObserver;

  constructor(node: ProseMirrorNode, _editor: Editor) {
    this.node = node;

    this.dom = document.createElement("div");
    this.dom.className = "mermaid-block";
    this.dom.setAttribute("data-testid", "mermaid-block");

    this.diagram = document.createElement("div");
    this.diagram.className = "mermaid-diagram";
    this.diagram.contentEditable = "false";
    this.diagram.setAttribute("role", "img");
    this.diagram.setAttribute("aria-label", "Mermaid diagram");
    this.diagram.setAttribute("data-testid", "mermaid-diagram");

    this.error = document.createElement("p");
    this.error.className = "mermaid-error";
    this.error.contentEditable = "false";
    this.error.setAttribute("role", "status");
    this.error.setAttribute("data-testid", "mermaid-error");
    this.error.hidden = true;

    const toolbar = document.createElement("div");
    toolbar.className = "mermaid-toolbar";
    toolbar.contentEditable = "false";

    nextSourceId += 1;
    const sourceId = `mermaid-source-${nextSourceId}`;
    this.sourceToggle = document.createElement("button");
    this.sourceToggle.type = "button";
    this.sourceToggle.className = toolbarButtonClass;
    this.sourceToggle.setAttribute("aria-controls", sourceId);
    this.sourceToggle.setAttribute("data-testid", "mermaid-source-toggle");
    this.sourceToggle.textContent = "Source";
    this.sourceToggle.addEventListener("click", () => {
      this.setSourceOpen(!this.sourceOpen);
    });

    this.pendingNote = document.createElement("span");
    this.pendingNote.className = "mermaid-pending-note";
    this.pendingNote.setAttribute("data-testid", "mermaid-pending-note");

    this.versionToggle = document.createElement("button");
    this.versionToggle.type = "button";
    this.versionToggle.className = toolbarButtonClass;
    this.versionToggle.setAttribute("data-testid", "mermaid-version-toggle");
    this.versionToggle.addEventListener("click", () => {
      this.showOriginal = !this.showOriginal;
      this.refresh(0);
    });

    toolbar.append(this.sourceToggle, this.pendingNote, this.versionToggle);

    const pre = document.createElement("pre");
    pre.id = sourceId;
    this.contentDOM = document.createElement("code");
    this.contentDOM.className = "language-mermaid";
    pre.append(this.contentDOM);

    this.dom.append(this.diagram, this.error, toolbar, pre);

    this.themeObserver = new MutationObserver(() => this.refresh(0));
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    this.setSourceOpen(false);
    this.refresh(0);
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type || node.attrs.language !== "mermaid") {
      return false;
    }
    this.node = node;
    this.refresh(renderDelayMs);
    return true;
  }

  // Clicks on the diagram and buttons belong to the view, not the editor.
  stopEvent(event: Event): boolean {
    return (
      event.target instanceof globalThis.Node &&
      !this.contentDOM.contains(event.target)
    );
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.themeObserver.disconnect();
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderToken += 1;
  }

  private setSourceOpen(open: boolean): void {
    this.sourceOpen = open;
    this.dom.toggleAttribute("data-source-open", open);
    this.sourceToggle.setAttribute("aria-expanded", String(open));
    this.sourceToggle.textContent = open ? "Hide source" : "Source";
  }

  private refresh(delayMs: number): void {
    const versions = codeSourceVersions(this.node);

    // Open the source when review appears in it, but let the reader close it.
    if (versions.hasReview && !this.hadReview) this.setSourceOpen(true);
    this.hadReview = versions.hasReview;

    if (!versions.hasSuggestions) this.showOriginal = false;
    const showingOriginal = versions.hasSuggestions && this.showOriginal;
    this.pendingNote.hidden = !versions.hasSuggestions;
    this.versionToggle.hidden = !versions.hasSuggestions;
    this.pendingNote.textContent = showingOriginal
      ? "Showing the original"
      : "Showing suggested changes";
    this.versionToggle.textContent = showingOriginal
      ? "Show suggested"
      : "Show original";

    const source = showingOriginal ? versions.original : versions.proposed;
    const theme = currentMermaidTheme();
    const key = `${theme}\n${source}`;
    if (key === this.renderedKey) return;

    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      void this.draw(source, theme, key);
    }, delayMs);
  }

  private async draw(
    source: string,
    theme: MermaidTheme,
    key: string,
  ): Promise<void> {
    this.renderToken += 1;
    const token = this.renderToken;

    if (!source.trim()) {
      this.renderedKey = key;
      this.diagram.replaceChildren();
      this.error.hidden = true;
      return;
    }

    const result = await renderMermaid(source, theme);
    if (token !== this.renderToken) return;

    this.renderedKey = key;
    if (result.ok) {
      this.diagram.innerHTML = result.svg;
      this.error.hidden = true;
      return;
    }

    // Keep the last diagram that drew, so a half-typed edit doesn't blank it.
    // Mermaid's parser errors run to several lines; the first says enough.
    const [summary = result.error] = result.error.split("\n");
    this.error.textContent = `Can't draw this diagram: ${summary}`;
    this.error.title = result.error;
    this.error.hidden = false;
    // With nothing drawn, the source is the only thing to look at.
    if (!this.diagram.hasChildNodes()) this.setSourceOpen(true);
  }
}
