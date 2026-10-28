import { Minus, Plus, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./components/ui/dialog";
import { PanZoom } from "./pan-zoom";

const stagePadding = 32;
const maxScale = 8;
const buttonZoomFactor = 1.25;
const keyPanStep = 64;
const keyPans = new Map<string, [number, number]>([
  ["ArrowLeft", [keyPanStep, 0]],
  ["ArrowRight", [-keyPanStep, 0]],
  ["ArrowUp", [0, keyPanStep]],
  ["ArrowDown", [0, -keyPanStep]],
]);
// Small diagrams open no larger than this, so they don't fill the window.
const maxOpeningScale = 1.5;

interface DiagramSize {
  width: number;
  height: number;
}

/**
 * Opens a diagram over the whole window, where it can be zoomed and moved
 * around. The viewer shows a copy of the diagram as drawn inline.
 */
export function openMermaidViewer(svg: string, returnFocus: HTMLElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <MermaidViewer
      svg={svg}
      returnFocus={returnFocus}
      onClosed={() => {
        root.unmount();
        host.remove();
      }}
    />,
  );
}

function MermaidViewer({
  svg,
  returnFocus,
  onClosed,
}: {
  svg: string;
  returnFocus: HTMLElement;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [scale, setScale] = useState(1);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panZoomRef = useRef<PanZoom | null>(null);
  const fitRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    canvas.innerHTML = svg;
    const size = showAtNaturalSize(canvas);
    const fitScale = () =>
      Math.min(
        (stage.clientWidth - 2 * stagePadding) / size.width,
        (stage.clientHeight - 2 * stagePadding) / size.height,
      );
    const panZoom = new PanZoom(stage, canvas, {
      minScale: () => Math.min(fitScale(), 1) / 2,
      maxScale,
      bounds: "visible",
      wheelPans: true,
      onChange: (transform) => setScale(transform.scale),
    });
    panZoomRef.current = panZoom;

    const centre = (nextScale: number, top?: number) =>
      panZoom.set({
        scale: nextScale,
        x: (stage.clientWidth - size.width * nextScale) / 2,
        y: top ?? (stage.clientHeight - size.height * nextScale) / 2,
      });
    fitRef.current = () => centre(Math.min(fitScale(), maxOpeningScale));

    // Open at the width that fills the window, so text is as large as it can
    // be; a tall diagram starts at its top and scrolls.
    const openingScale = Math.min(
      (stage.clientWidth - 2 * stagePadding) / size.width,
      maxOpeningScale,
    );
    const fitsHeight =
      size.height * openingScale <= stage.clientHeight - 2 * stagePadding;
    centre(openingScale, fitsHeight ? undefined : stagePadding);

    return () => {
      panZoom.destroy();
      panZoomRef.current = null;
    };
  }, [stage, svg]);

  const zoomBy = (factor: number) => panZoomRef.current?.zoomBy(factor);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const pan = keyPans.get(event.key);
    if (event.key === "+" || event.key === "=") zoomBy(buttonZoomFactor);
    else if (event.key === "-") zoomBy(1 / buttonZoomFactor);
    else if (event.key === "0") fitRef.current();
    else if (pan) panZoomRef.current?.panBy(...pan);
    else return;
    event.preventDefault();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed();
      }}
    >
      <DialogContent
        data-testid="mermaid-viewer"
        showCloseButton={false}
        finalFocus={{ current: returnFocus }}
        onKeyDown={onKeyDown}
        className="top-0 left-0 z-[70] flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 shadow-none"
      >
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <DialogTitle className="sr-only">Diagram</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Shift-scroll or pinch to zoom. Drag to move.
          </DialogDescription>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom out"
              title="Zoom out (-)"
              data-testid="mermaid-viewer-zoom-out"
              onClick={() => zoomBy(1 / buttonZoomFactor)}
            >
              <Minus />
            </Button>
            <output
              aria-label="Zoom level"
              data-testid="mermaid-viewer-zoom-level"
              className="w-12 text-center text-xs tabular-nums text-muted-foreground"
            >
              {Math.round(scale * 100)}%
            </output>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom in"
              title="Zoom in (+)"
              data-testid="mermaid-viewer-zoom-in"
              onClick={() => zoomBy(buttonZoomFactor)}
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Fit to window (0)"
              data-testid="mermaid-viewer-fit"
              onClick={() => fitRef.current()}
            >
              Fit
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              title="Close (Esc)"
              data-testid="mermaid-viewer-close"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </div>
        </div>
        <div
          ref={setStage}
          data-testid="mermaid-viewer-stage"
          className="mermaid-viewer-stage relative min-h-0 flex-1 overflow-hidden"
        >
          <div
            ref={canvasRef}
            role="img"
            aria-label="Mermaid diagram"
            className="absolute top-0 left-0"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Inline, Mermaid's SVG scales to its column. Here it takes its own size and
// the viewer scales it instead.
function showAtNaturalSize(canvas: HTMLElement): DiagramSize {
  const svg = canvas.querySelector("svg");
  if (!svg) return { width: 1, height: 1 };
  const viewBox = svg.viewBox?.baseVal;
  const rect = svg.getBoundingClientRect();
  const width = viewBox?.width || rect.width || 1;
  const height = viewBox?.height || rect.height || 1;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.style.maxWidth = "none";
  return { width, height };
}
