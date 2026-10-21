/// <reference types="vite/client" />

declare module "@joplin/turndown-plugin-gfm" {
  export const tables: unknown;
  export const taskListItems: unknown;
}

// Exposed by the desktop app's preload script; absent in plain browsers.
interface RoughdraftDesktopOpenIntent {
  path: string;
  modifiedAt: number | null;
  activate?: boolean;
}

type RoughdraftDesktopDocumentClaim =
  | { status: "claimed"; path: string }
  | { status: "focused-existing" };

interface Window {
  roughdraftDesktop?: {
    session: { key: string; migrateLegacy: boolean };
    startDocumentSession: (paths: string[]) => Promise<string[]>;
    claimDocument: (path: string) => Promise<RoughdraftDesktopDocumentClaim>;
    reportOpenDocuments: (paths: string[]) => void;
    releaseDocument: (path: string) => void;
    ready: () => void;
    onOpenDocument: (
      listener: (intent: RoughdraftDesktopOpenIntent) => void,
    ) => () => void;
    onPrepareClose: (prepare: () => Promise<boolean>) => () => void;
    locateMarkdownFile?: () => Promise<string | null>;
    setRecentDocuments?: (paths: string[]) => void;
  };
}
