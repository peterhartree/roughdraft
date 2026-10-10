import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createApplicationMenuTemplate } from "./application-menu.js";

function fileMenuItem(
  template: MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions | undefined {
  const fileMenu = template.find((item) => item.label === "File");
  return Array.isArray(fileMenu?.submenu)
    ? fileMenu.submenu.find((item) => item.label === label)
    : undefined;
}

function click(item: MenuItemConstructorOptions | undefined): void {
  if (!item?.click) throw new Error("Menu action unavailable");
  item.click({} as never, {} as never, {} as never);
}

function openRecentItems(
  template: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  const submenu = fileMenuItem(template, "Open Recent")?.submenu;
  if (!Array.isArray(submenu)) throw new Error("Open Recent submenu missing");
  return submenu;
}

describe("desktop application menu", () => {
  it("offers File > Open with the native open shortcut", () => {
    const openMarkdownFile = vi.fn();
    const template = createApplicationMenuTemplate(
      {
        newMarkdownFile: vi.fn(),
        openMarkdownFile,
        openRecentDocument: vi.fn(),
      },
      [],
      "darwin",
    );
    const openItem = fileMenuItem(template, "Open…");

    expect(openItem).toMatchObject({ accelerator: "CommandOrControl+O" });
    click(openItem);
    expect(openMarkdownFile).toHaveBeenCalledOnce();
  });

  it("offers File > New with the native new-document shortcut", () => {
    const newMarkdownFile = vi.fn();
    const template = createApplicationMenuTemplate(
      {
        newMarkdownFile,
        openMarkdownFile: vi.fn(),
        openRecentDocument: vi.fn(),
      },
      [],
      "darwin",
    );
    const newItem = fileMenuItem(template, "New…");

    expect(newItem).toMatchObject({ accelerator: "CommandOrControl+N" });
    click(newItem);
    expect(newMarkdownFile).toHaveBeenCalledOnce();
  });

  it("lists recent documents in File > Open Recent and opens the chosen one", () => {
    const openRecentDocument = vi.fn();
    const template = createApplicationMenuTemplate(
      {
        newMarkdownFile: vi.fn(),
        openMarkdownFile: vi.fn(),
        openRecentDocument,
      },
      ["/Users/me/notes/plan.md", "/Users/me/drafts/essay.md"],
      "darwin",
    );
    const items = openRecentItems(template);

    expect(items.map((item) => item.label)).toEqual(["plan.md", "essay.md"]);
    click(items[1]);
    expect(openRecentDocument).toHaveBeenCalledExactlyOnceWith(
      "/Users/me/drafts/essay.md",
    );
  });

  it("names the parent folder when recent documents share a filename", () => {
    const template = createApplicationMenuTemplate(
      {
        newMarkdownFile: vi.fn(),
        openMarkdownFile: vi.fn(),
        openRecentDocument: vi.fn(),
      },
      ["/Users/me/alpha/README.md", "/Users/me/beta/README.md"],
      "darwin",
    );

    expect(openRecentItems(template).map((item) => item.label)).toEqual([
      "README.md — alpha",
      "README.md — beta",
    ]);
  });

  it("shows a disabled placeholder when there are no recent documents", () => {
    const template = createApplicationMenuTemplate(
      {
        newMarkdownFile: vi.fn(),
        openMarkdownFile: vi.fn(),
        openRecentDocument: vi.fn(),
      },
      [],
      "darwin",
    );

    expect(openRecentItems(template)).toEqual([
      { label: "No recent documents", enabled: false },
    ]);
  });
});
