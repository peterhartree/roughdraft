import type { MenuItemConstructorOptions } from "electron";
import { createRecentDocumentMenuEntries } from "./recent-documents.js";

export interface ApplicationMenuActions {
  newWindow?: () => void;
  newMarkdownFile: () => void;
  openMarkdownFile: () => void;
  openRecentDocument: (filePath: string) => void;
}

function createOpenRecentSubmenu(
  recentDocumentPaths: string[],
  openRecentDocument: (filePath: string) => void,
): MenuItemConstructorOptions[] {
  if (recentDocumentPaths.length === 0) {
    return [{ label: "No recent documents", enabled: false }];
  }

  return createRecentDocumentMenuEntries(recentDocumentPaths).map((entry) => ({
    label: entry.label,
    toolTip: entry.path,
    click: () => openRecentDocument(entry.path),
  }));
}

export function createApplicationMenuTemplate(
  actions: ApplicationMenuActions,
  recentDocumentPaths: string[] = [],
  platform = process.platform,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];

  if (platform === "darwin") {
    template.push({ role: "appMenu" });
  }

  template.push(
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CommandOrControl+Shift+N",
          click: () => actions.newWindow?.(),
        },
        {
          label: "New…",
          accelerator: "CommandOrControl+N",
          click: () => actions.newMarkdownFile(),
        },
        {
          label: "Open…",
          accelerator: "CommandOrControl+O",
          click: () => actions.openMarkdownFile(),
        },
        {
          label: "Open Recent",
          submenu: createOpenRecentSubmenu(
            recentDocumentPaths,
            actions.openRecentDocument,
          ),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  );

  return template;
}
