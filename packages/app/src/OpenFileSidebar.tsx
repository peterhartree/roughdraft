import { Copy, FileText } from "lucide-react";
import { useRef } from "react";
import { Button } from "./components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./components/ui/context-menu";
import { cn } from "./lib/utils";
import {
  formatOpenFileParentPath,
  getOpenFileName,
  type OpenFileItem,
} from "./open-file-navigation";

export function OpenFileSidebar({
  files,
  activePath,
  disabled,
  error,
  onSelect,
  onCopyPath,
}: {
  files: OpenFileItem[];
  activePath: string | null;
  disabled: boolean;
  error: string | null;
  onSelect: (path: string) => void;
  onCopyPath: (path: string) => void | Promise<void>;
}) {
  const contextMenuPathRef = useRef<string | null>(null);

  return (
    <aside
      id="open-file-sidebar"
      aria-label="Open files"
      className="flex h-screen w-[var(--roughdraft-sidebar-width)] shrink-0 flex-col border-r border-stone-200 bg-[#F6F6F3] text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50"
      data-testid="open-file-sidebar"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-stone-200 px-3 dark:border-slate-800">
        <span className="text-xs font-semibold tracking-[0.08em] text-stone-600 uppercase dark:text-stone-300">
          Files
        </span>
        <span
          title={`${files.length} open ${files.length === 1 ? "file" : "files"}`}
          className="text-[0.68rem] tabular-nums text-stone-400 dark:text-stone-500"
        >
          {files.length}
        </span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <ol
                className="grid min-w-0 grid-cols-[minmax(0,1fr)] list-none gap-0.5 p-0"
                onContextMenuCapture={(event) => {
                  const item = (
                    event.target as HTMLElement
                  ).closest<HTMLElement>("[data-file-path]");
                  if (!item) {
                    contextMenuPathRef.current = null;
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                  contextMenuPathRef.current = item.dataset.filePath ?? null;
                }}
              >
                {files.map((file, index) => {
                  const active = file.path === activePath;
                  const filename = getOpenFileName(file.path);
                  return (
                    <li key={file.path} className="min-w-0">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-disabled={disabled && !active}
                        aria-current={active ? "page" : undefined}
                        aria-label={`${filename}${file.unread ? ", unread" : ""}`}
                        title={file.path}
                        data-testid="open-file-sidebar-item"
                        data-file-path={file.path}
                        data-unread={file.unread ? "true" : "false"}
                        className={cn(
                          "group h-auto w-full max-w-full justify-start gap-2 overflow-hidden rounded-md px-2 py-2 text-left hover:bg-stone-200/75 aria-disabled:opacity-50 dark:hover:bg-slate-800",
                          active &&
                            "bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:bg-white dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-800",
                        )}
                        onClick={() => {
                          if (disabled && !active) return;
                          onSelect(file.path);
                        }}
                      >
                        <span className="relative flex size-4 shrink-0 items-center justify-center">
                          <FileText
                            className={cn(
                              "size-3.5 text-stone-400 dark:text-stone-500",
                              active && "text-stone-700 dark:text-stone-200",
                            )}
                            aria-hidden="true"
                          />
                          {file.unread ? (
                            <span
                              className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-blue-500 ring-2 ring-[#F6F6F3] dark:bg-blue-400 dark:ring-slate-950"
                              data-testid="open-file-unread-indicator"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate text-[0.78rem] leading-4 font-medium",
                              file.unread && "font-semibold",
                            )}
                          >
                            {filename}
                          </span>
                          <span className="mt-0.5 block truncate text-[0.64rem] leading-3 text-stone-400 dark:text-stone-500">
                            {formatOpenFileParentPath(file.path)}
                          </span>
                        </span>
                        {index < 9 ? (
                          <span
                            className="shrink-0 text-[0.6rem] tabular-nums text-stone-300 group-hover:text-stone-500 dark:text-slate-600 dark:group-hover:text-slate-400"
                            aria-hidden="true"
                          >
                            ⌘{index + 1}
                          </span>
                        ) : null}
                      </Button>
                    </li>
                  );
                })}
              </ol>
            }
          />
          <ContextMenuContent
            aria-label="File actions"
            data-open-file-sidebar-context-menu=""
          >
            <ContextMenuItem
              data-testid="open-file-sidebar-copy-path"
              onClick={() => {
                const path = contextMenuPathRef.current;
                if (path && files.some((file) => file.path === path)) {
                  void onCopyPath(path);
                }
              }}
            >
              <Copy className="size-3.5 text-stone-500 dark:text-slate-400" />
              Copy path
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </nav>

      {error ? (
        <div
          role="alert"
          className="mx-2 mb-1 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[0.68rem] leading-4 text-red-700 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-300"
          data-testid="open-file-switch-error"
        >
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-stone-200 px-3 py-2 text-[0.62rem] leading-4 text-stone-400 dark:border-slate-800 dark:text-stone-500">
        <span>
          <span aria-hidden="true">⌘W</span> close
        </span>
        <span>
          <span aria-hidden="true">⌘P</span> switch
        </span>
      </div>
    </aside>
  );
}
