import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { codeSourceVersions } from "./code-source-versions";
import { buttonVariants } from "./components/ui/button";

// The server serves this page with its own Content Security Policy: inline
// scripts and styles run, but nothing loads from the network. The message
// types must match packages/server/src/live-html-frame.ts.
export const liveHtmlFrameUrl = "/api/live-html-frame";
const readyMessage = "roughdraft-live-html:ready";
const renderMessage = "roughdraft-live-html:render";
const heightMessage = "roughdraft-live-html:height";

const renderDelayMs = 400;
const minFrameHeight = 40;
const maxFrameHeight = 1600;
const toolbarButtonClass = buttonVariants({ variant: "ghost", size: "xs" });

let nextSourceId = 0;

export function isLiveHtmlCodeBlock(node: ProseMirrorNode): boolean {
  return (
    node.attrs.language === "html" &&
    /(?:^|\s)live(?:\s|$)/.test(String(node.attrs.meta ?? ""))
  );
}

/**
 * A ```` ```html live ```` fence runs its HTML in a sandboxed frame, with the
 * editable source under a "Source" disclosure. The frame has an opaque
 * origin, so the widget cannot read Roughdraft's storage or call its API, and
 * it is recreated on every change so each version starts clean. Review works
 * as for Mermaid fences: the source opens when it carries comments or
 * suggestions, and the frame runs the suggested version, with a toggle back
 * to the original.
 */
export class LiveHtmlCodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private node: ProseMirrorNode;
  private preview: HTMLElement;
  private frame: HTMLIFrameElement | null = null;
  private frameHtml = "";
  private sourceToggle: HTMLButtonElement;
  private versionToggle: HTMLButtonElement;
  private pendingNote: HTMLElement;
  private sourceOpen = false;
  private showOriginal = false;
  private hadReview = false;
  private renderedHtml: string | null = null;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onMessage = (event: MessageEvent) => {
    if (!this.frame || event.source !== this.frame.contentWindow) return;
    const data = event.data as { type?: unknown; height?: unknown } | null;
    if (data?.type === readyMessage) {
      this.frame.contentWindow?.postMessage(
        { type: renderMessage, html: this.frameHtml },
        "*",
      );
    } else if (
      data?.type === heightMessage &&
      typeof data.height === "number"
    ) {
      const height = Math.min(
        maxFrameHeight,
        Math.max(minFrameHeight, Math.ceil(data.height)),
      );
      this.frame.style.height = `${height}px`;
    }
  };

  constructor(node: ProseMirrorNode) {
    this.node = node;

    this.dom = document.createElement("div");
    this.dom.className = "live-html-block";
    this.dom.setAttribute("data-testid", "live-html-block");

    this.preview = document.createElement("div");
    this.preview.className = "live-html-preview";
    this.preview.contentEditable = "false";

    const toolbar = document.createElement("div");
    toolbar.className = "live-html-toolbar";
    toolbar.contentEditable = "false";

    nextSourceId += 1;
    const sourceId = `live-html-source-${nextSourceId}`;
    this.sourceToggle = document.createElement("button");
    this.sourceToggle.type = "button";
    this.sourceToggle.className = toolbarButtonClass;
    this.sourceToggle.setAttribute("aria-controls", sourceId);
    this.sourceToggle.setAttribute("data-testid", "live-html-source-toggle");
    this.sourceToggle.addEventListener("click", () => {
      this.setSourceOpen(!this.sourceOpen);
    });

    this.pendingNote = document.createElement("span");
    this.pendingNote.setAttribute("data-testid", "live-html-pending-note");

    this.versionToggle = document.createElement("button");
    this.versionToggle.type = "button";
    this.versionToggle.className = toolbarButtonClass;
    this.versionToggle.setAttribute("data-testid", "live-html-version-toggle");
    this.versionToggle.addEventListener("click", () => {
      this.showOriginal = !this.showOriginal;
      this.refresh(0);
    });

    toolbar.append(this.sourceToggle, this.pendingNote, this.versionToggle);

    const pre = document.createElement("pre");
    pre.id = sourceId;
    this.contentDOM = document.createElement("code");
    this.contentDOM.className = "language-html";
    pre.append(this.contentDOM);

    this.dom.append(this.preview, toolbar, pre);
    window.addEventListener("message", this.onMessage);

    this.setSourceOpen(false);
    this.refresh(0);
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type || !isLiveHtmlCodeBlock(node)) {
      return false;
    }
    this.node = node;
    this.refresh(renderDelayMs);
    return true;
  }

  // Clicks in the frame and on the buttons belong to the view, not the editor.
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
    window.removeEventListener("message", this.onMessage);
    if (this.renderTimer) clearTimeout(this.renderTimer);
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

    const html = showingOriginal ? versions.original : versions.proposed;
    if (html === this.renderedHtml) return;

    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.run(html);
    }, delayMs);
  }

  private run(html: string): void {
    this.renderedHtml = html;
    this.frameHtml = html;

    const frame = document.createElement("iframe");
    frame.className = "live-html-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", "Live HTML preview");
    frame.setAttribute("data-testid", "live-html-frame");
    // Keep the old frame's height while the new one loads, so the page
    // doesn't jump on every keystroke.
    frame.style.height = this.frame?.style.height || `${minFrameHeight * 4}px`;
    frame.src = liveHtmlFrameUrl;

    this.frame = frame;
    this.preview.replaceChildren(frame);
  }
}
