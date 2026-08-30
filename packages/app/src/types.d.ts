/// <reference types="vite/client" />

declare module "@joplin/turndown-plugin-gfm" {
  export const tables: unknown;
  export const taskListItems: unknown;
}

// Exposed by the desktop app's preload script; absent in plain browsers.
interface Window {
  roughdraftDesktop?: {
    locateMarkdownFile?: () => Promise<string | null>;
  };
}
