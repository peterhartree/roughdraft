# 0008: Creating and renaming files

## Context

ADR 0007 left creating and renaming files to a separate decision. In practice a reviewer names a file once its content settles, and starts new notes or plans while already working in Roughdraft. Leaving for Finder or the terminal for either breaks the flow, and a rename done outside Roughdraft orphans the file's Open-list entry, pins and saved view position.

## Decision

**Rename.** A Markdown file can be renamed from its context menu in Browse and in the Open list. A dialog asks for the new name with the part before `.md` selected; a name typed without `.md` gets it added. Renaming stays within the file's own folder: names containing a slash are refused, as is any name already taken by another file in that folder. A change of letter case alone is allowed. The server performs the rename (`POST /api/markdown-file/rename`) and never replaces a file.

Renaming the active file saves pending edits first and refuses while the file has an unresolved disk change or conflict, so no save can recreate the old path. The file keeps its place in the Open list, its view position, its recent-documents entry and its pins under the new path.

**New.** In the desktop app, `File > New…` (`Command+N`) opens the native save panel in the active document's folder, else the most recently opened document's folder, else Documents, with the name `Untitled.md`. The main process creates the empty file and sends it through the existing open intent, so it joins the Open list and becomes active. A file the panel's replace confirmation agreed to replace goes to the Trash rather than being overwritten.

## Consequences

Roughdraft can start and name review files without becoming a file manager: there is still no move between folders, folder creation or deletion, or batch renaming. New files need the desktop shell, because only it can show a native save panel; in a browser tab `Command+N` stays with the browser.

The rename endpoint, like the other local-file endpoints, accepts any absolute `.md` path and is not covered by the remote-document token.
