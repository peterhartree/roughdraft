import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoveToTrashButton } from "../src/MoveToTrashButton";

describe("move to Trash button", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function button() {
    return container.querySelector<HTMLButtonElement>(
      '[data-testid="document-move-to-trash-button"]',
    ) as HTMLButtonElement;
  }

  async function render(onConfirm: () => Promise<void>) {
    await act(async () =>
      root.render(<MoveToTrashButton onConfirm={onConfirm} />),
    );
  }

  it("asks for a second click before moving the file to the Trash", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    await render(onConfirm);

    await act(async () => button().click());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button().getAttribute("aria-label")).toBe("Confirm: move to Trash");
    expect(button().textContent).toContain("Move to Trash?");

    await act(async () => button().click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disarms after a few seconds without a second click", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    await render(onConfirm);

    await act(async () => button().click());
    await act(async () => vi.advanceTimersByTime(4000));

    expect(button().getAttribute("aria-label")).toBe("Move to Trash");
    await act(async () => button().click());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disarms on Escape", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    await render(onConfirm);

    await act(async () => button().click());
    await act(async () =>
      button().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );

    expect(button().getAttribute("aria-label")).toBe("Move to Trash");
  });
});
