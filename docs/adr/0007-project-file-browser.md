# 0007: Project and pinned-folder file browser

## Context

Reviewers often need a neighbouring Markdown file — another plan in the same repository, last week's review, a decision record — and leaving the app for the terminal or Finder to open it breaks the review flow. ADR 0001 rules out vaults and indexes, and ADR 0006 keeps the open-file list limited to explicitly opened files.

## Decision

The local-file sidebar gains a **Browse** section stacked below the **Open** list, with a resizable divider. The Open list keeps every rule from ADR 0006.

Browse shows two kinds of tree:

- **Pinned:** a global section shown first, in a stable order. Files added here appear as single rows; projects and folders appear as their own trees. A pinned project that is also the current project appears only here, with a note in its place under Project.
- **Project:** the active file's project, defined as the nearest ancestor directory containing a `.git` entry (directory or file). The home directory and filesystem root are never treated as projects. Without a git ancestor, the file's own directory is used; a loose file directly in the home directory lists only that directory's own Markdown files.

Files and folders inside a tree can also be pinned to the top of that tree, above its normal contents, with their folder path as a hint. Both kinds of pin are stored by absolute path; an in-tree pin whose target is missing is hidden rather than forgotten.

Each folder sorts its direct contents A–Z by default, folders above files. A folder can be switched to Z–A from its context menu; the choice is remembered for that folder only.

Trees list Markdown files only. Folders without Markdown beneath them are hidden. Dependency, build and cache directories (`.git`, `node_modules`, `dist` and similar) are skipped; `.gitignore` is not applied, because gitignored dot-folders such as `.context/` often hold the plans being reviewed. A listing stops at 5,000 files or 20,000 directories and says so.

The server lists a tree on request (`GET /api/markdown-tree`) and keeps no index. The renderer refetches when the active file changes and when the window regains focus; it does not watch folders. Pins, in-project pins, folder sort orders, folder open states, the divider position and section folds are stored in browser-local storage.

Markdown files can be moved to the operating system's Trash from the Browse and Open context menus, without confirmation, and from the document top bar, where the button asks for a second click in place. Roughdraft never deletes permanently: on macOS it uses `/usr/bin/trash` (falling back to Finder), on Linux `gio trash`, and elsewhere it refuses. Closing comes before trashing, so no pending save can recreate the file; trashing the last open file returns to the recent-documents page.

Choosing a file in Browse behaves like an explicit open request: the file joins the Open list and becomes active unless a switch is blocked, in which case it waits there unread. When no document is open but folders are pinned, the sidebar appears beside the recent-documents page.

`Command+Option+Left` and `Command+Option+Right` step to the previous and next file in the Open list, stopping at either end. `Command+Left` and `Command+Right` remain unclaimed.

## Consequences

Roughdraft can reach neighbouring files without becoming a vault: there is still no database, global index, search or file management. Listings may be stale until the window regains focus. Pinning is limited to folders visible in an existing tree; a native folder picker would need privileged desktop API, which ADR 0005 avoids. In a browser tab, `Command+Option+Left/Right` is claimed by the browser, so stepping is reliable only in the desktop app.

Like the other local-file endpoints, the listing endpoint accepts any absolute path and is not covered by the remote-document token, so it is reachable wherever the server is. It reveals Markdown file names and modification times, never contents.

Creating, renaming or moving files, deleting folders, permanent deletion, searching the trees, and folder watching would require separate decisions.
