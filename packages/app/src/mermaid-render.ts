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
      return { ok: true, svg: contrastNodeLabels(svg) };
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

const nodeShapes = "rect, polygon, path, circle, ellipse";

/**
 * A `classDef` that sets a fill but no text colour leaves the theme's text
 * colour on the label, so a light fill in dark mode (or a dark fill in light
 * mode) hides it. Give such labels whichever text colour the fill can carry.
 */
function contrastNodeLabels(svg: string): string {
  const template = document.createElement("template");
  template.innerHTML = svg;
  let changed = false;
  for (const node of template.content.querySelectorAll<SVGGElement>("g.node")) {
    const shape = node.querySelector<SVGElement>(nodeShapes);
    const fill = shape?.style.getPropertyValue("fill");
    if (!fill) continue;
    const labels = node.querySelectorAll<HTMLElement | SVGElement>(
      ".nodeLabel, text",
    );
    if (
      labels.length === 0 ||
      [...node.querySelectorAll<HTMLElement>("[style]")].some((element) =>
        element.style.getPropertyValue("color"),
      )
    ) {
      continue;
    }
    const luminance = relativeLuminance(fill);
    if (luminance === null) continue;
    const text = luminance > 0.4 ? "#1f2328" : "#f6f8fa";
    for (const label of labels) {
      label.style.setProperty("color", text, "important");
      label.style.setProperty("fill", text, "important");
    }
    changed = true;
  }
  return changed ? template.innerHTML : svg;
}

function relativeLuminance(colour: string): number | null {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.fillStyle = "#010203";
  context.fillStyle = colour;
  const normalised = context.fillStyle;
  const match = /^#([0-9a-f]{6})$/i.exec(normalised);
  if (!match || normalised === "#010203") return null;
  const value = Number.parseInt(match[1], 16);
  const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255].map(
    (channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    },
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
