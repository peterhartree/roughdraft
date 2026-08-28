import { describe, expect, it, vi } from "vitest";
import { createApplicationMenuTemplate } from "./application-menu.js";

describe("desktop application menu", () => {
  it("offers File > Open with the native open shortcut", () => {
    const openMarkdownFile = vi.fn();
    const template = createApplicationMenuTemplate(openMarkdownFile, "darwin");
    const fileMenu = template.find((item) => item.label === "File");
    const openItem = Array.isArray(fileMenu?.submenu)
      ? fileMenu.submenu.find(
          (item) => "label" in item && item.label === "Open…",
        )
      : undefined;

    expect(openItem).toMatchObject({ accelerator: "CommandOrControl+O" });
    if (!openItem || !("click" in openItem) || !openItem.click) {
      throw new Error("Open menu action unavailable");
    }

    openItem.click({} as never, {} as never, {} as never);
    expect(openMarkdownFile).toHaveBeenCalledOnce();
  });
});
