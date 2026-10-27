export type MermaidTheme = "light" | "dark";

export type MermaidRenderResult =
  | { ok: true; svg: string }
  | { ok: false; error: string };

let nextDiagramId = 0;
let renderQueue: Promise<unknown> = Promise.resolve();

export function currentMermaidTheme(): MermaidTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Mermaid is loaded only when a document has a diagram. Strict security keeps
 * click handlers and HTML labels out, and Mermaid sanitises its own output.
 * Renders run one at a time because Mermaid's configuration is global.
 */
export function renderMermaid(
  source: string,
  theme: MermaidTheme,
): Promise<MermaidRenderResult> {
  const render = async (): Promise<MermaidRenderResult> => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "neutral",
      fontFamily: "Inter Variable, sans-serif",
    });

    nextDiagramId += 1;
    const id = `roughdraft-mermaid-${nextDiagramId}`;
    try {
      const { svg } = await mermaid.render(id, source);
      return { ok: true, svg };
    } catch (error) {
      // A failed render leaves its scratch element behind.
      document.getElementById(`d${id}`)?.remove();
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const result = renderQueue.then(render, render);
  renderQueue = result;
  return result;
}
