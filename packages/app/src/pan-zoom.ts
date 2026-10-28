export interface PanZoomTransform {
  scale: number;
  x: number;
  y: number;
}

interface PanZoomOptions {
  minScale: () => number;
  maxScale: number;
  /**
   * "cover" keeps zoomed content filling its own box, so an inline diagram
   * zooms within its frame and can't be dragged away. "visible" keeps only
   * part of the content on screen, for a viewer the content moves around in.
   */
  bounds: "cover" | "visible";
  /** Whether a plain wheel pans. Otherwise it is left to scroll the page. */
  wheelPans: boolean;
  onChange?: (transform: PanZoomTransform) => void;
}

const identity: PanZoomTransform = { scale: 1, x: 0, y: 0 };
// How much of the content stays on screen under "visible" bounds.
const visibleMargin = 48;
const lineHeightPx = 16;

/**
 * Shift-scroll or a trackpad pinch zooms the content around the pointer, and
 * dragging moves it. The content is transformed from its top-left corner, so
 * its untransformed box stays put in the layout.
 */
export class PanZoom {
  private current: PanZoomTransform = identity;
  private drag: { pointerId: number; x: number; y: number } | null = null;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly content: HTMLElement,
    private readonly options: PanZoomOptions,
  ) {
    content.style.transformOrigin = "0 0";
    viewport.addEventListener("wheel", this.onWheel, { passive: false });
    viewport.addEventListener("pointerdown", this.onPointerDown);
    viewport.addEventListener("pointermove", this.onPointerMove);
    viewport.addEventListener("pointerup", this.onPointerUp);
    viewport.addEventListener("pointercancel", this.onPointerUp);
    this.apply();
  }

  get transform(): PanZoomTransform {
    return this.current;
  }

  get zoomed(): boolean {
    const { scale, x, y } = this.current;
    return scale !== 1 || x !== 0 || y !== 0;
  }

  set(transform: PanZoomTransform): void {
    this.current = this.clamp(transform);
    this.apply();
  }

  reset(): void {
    this.set(identity);
  }

  zoomAt(factor: number, clientX: number, clientY: number): void {
    const { scale, x, y } = this.current;
    const next = Math.min(
      this.options.maxScale,
      Math.max(this.options.minScale(), scale * factor),
    );
    const ratio = next / scale;
    // The untransformed origin, from where the transform has put the corner.
    const rect = this.content.getBoundingClientRect();
    const pointX = clientX - (rect.left - x);
    const pointY = clientY - (rect.top - y);
    this.set({
      scale: next,
      x: pointX - (pointX - x) * ratio,
      y: pointY - (pointY - y) * ratio,
    });
  }

  zoomBy(factor: number): void {
    const rect = this.viewport.getBoundingClientRect();
    this.zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  panBy(dx: number, dy: number): void {
    const { scale, x, y } = this.current;
    this.set({ scale, x: x + dx, y: y + dy });
  }

  destroy(): void {
    this.viewport.removeEventListener("wheel", this.onWheel);
    this.viewport.removeEventListener("pointerdown", this.onPointerDown);
    this.viewport.removeEventListener("pointermove", this.onPointerMove);
    this.viewport.removeEventListener("pointerup", this.onPointerUp);
    this.viewport.removeEventListener("pointercancel", this.onPointerUp);
  }

  private get pannable(): boolean {
    return this.options.bounds === "visible" || this.current.scale > 1;
  }

  private clamp({ scale, x, y }: PanZoomTransform): PanZoomTransform {
    const width = this.content.offsetWidth * scale;
    const height = this.content.offsetHeight * scale;
    if (this.options.bounds === "cover") {
      const boxWidth = this.content.offsetWidth;
      const boxHeight = this.content.offsetHeight;
      return {
        scale,
        x: Math.min(0, Math.max(boxWidth - width, x)),
        y: Math.min(0, Math.max(boxHeight - height, y)),
      };
    }
    const marginX = Math.min(visibleMargin, width);
    const marginY = Math.min(visibleMargin, height);
    return {
      scale,
      x: Math.min(
        this.viewport.clientWidth - marginX,
        Math.max(marginX - width, x),
      ),
      y: Math.min(
        this.viewport.clientHeight - marginY,
        Math.max(marginY - height, y),
      ),
    };
  }

  private apply(): void {
    const { scale, x, y } = this.current;
    this.content.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.viewport.toggleAttribute("data-zoomed", this.zoomed);
    this.viewport.toggleAttribute("data-pannable", this.pannable);
    this.options.onChange?.(this.current);
  }

  private readonly onWheel = (event: WheelEvent) => {
    if (event.shiftKey || event.ctrlKey) {
      event.preventDefault();
      this.zoomAt(wheelZoomFactor(event), event.clientX, event.clientY);
      return;
    }
    if (!this.options.wheelPans) return;
    event.preventDefault();
    const unit = wheelUnit(event, this.viewport);
    this.panBy(-event.deltaX * unit, -event.deltaY * unit);
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.pannable) return;
    // Buttons inside the viewport keep their clicks.
    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }
    event.preventDefault();
    this.drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    this.viewport.setPointerCapture?.(event.pointerId);
    this.viewport.setAttribute("data-panning", "");
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.panBy(event.clientX - this.drag.x, event.clientY - this.drag.y);
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.drag = null;
    this.viewport.releasePointerCapture?.(event.pointerId);
    this.viewport.removeAttribute("data-panning");
  };
}

function wheelUnit(event: WheelEvent, viewport: HTMLElement): number {
  if (event.deltaMode === 1) return lineHeightPx;
  if (event.deltaMode === 2) return viewport.clientHeight;
  return 1;
}

// The rates follow d3-zoom's, which suit both mouse wheels and trackpads.
function wheelZoomFactor(event: WheelEvent): number {
  // macOS turns a Shift-held mouse wheel's vertical scroll into a horizontal one.
  const delta = event.deltaY || event.deltaX;
  const rate = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
  // A trackpad pinch arrives as a ctrl-wheel with small deltas.
  return 2 ** (-delta * rate * (event.ctrlKey ? 10 : 1));
}
