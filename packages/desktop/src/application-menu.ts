import type { MenuItemConstructorOptions } from "electron";

export function createApplicationMenuTemplate(
  openMarkdownFile: () => void,
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
          label: "Open…",
          accelerator: "CommandOrControl+O",
          click: () => openMarkdownFile(),
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
