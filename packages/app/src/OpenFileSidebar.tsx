import { ChevronDown, Copy, FileText, Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
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

const DEFAULT_OPEN_SECTION_HEIGHT = 262;
const MIN_OPEN_SECTION_HEIGHT = 88;
const MIN_BROWSE_SECTION_HEIGHT = 160;

export interface SidebarBrowseSection {
  content: ReactNode;
  openSectionHeight: number | null;
  openSectionCollapsed: boolean;
  browseSectionCollapsed: boolean;
  onOpenSectionHeightChange: (height: number) => void;
  onToggleOpenSection: () => void;
  onToggleBrowseSection: () => void;
}

function SectionHeader({
  title,
  expanded,
  onToggle,
  className,
  children,
}: {
  title: string;
  expanded: boolean | null;
  onToggle?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const label = (
    <span className="text-xs font-semibold tracking-[0.08em] text-stone-600 uppercase dark:text-stone-300">
      {title}
    </span>
  );
  if (expanded === null || !onToggle) {
    return (
      <div
        className={cn(
          "flex h-12 shrink-0 items-center justify-between border-b border-stone-200 px-3 dark:border-slate-800",
          className,
        )}
      >
        {label}
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={expanded}
      className={cn(
        "flex h-10 w-full shrink-0 cursor-default items-center gap-1.5 border-b border-stone-200 pr-3 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset dark:border-slate-800",
        !expanded && "border-b-transparent",
        className,
      )}
      onClick={onToggle}
    >
      <ChevronDown
        className={cn(
          "size-3.5 text-stone-400 transition-transform duration-150 motion-reduce:transition-none dark:text-stone-500",
          !expanded && "-rotate-90",
        )}
        aria-hidden="true"
      />
      {label}
      <span className="ml-auto">{children}</span>
    </button>
  );
}

export function OpenFileSidebar({
  files,
  activePath,
  disabled,
  error,
  onSelect,
  onCopyPath,
  onMoveToTrash,
  onRename,
  browse,
  notice,
}: {
  files: OpenFileItem[];
  activePath: string | null;
  disabled: boolean;
  error: string | null;
  onSelect: (path: string) => void;
  onCopyPath: (path: string) => void | Promise<void>;
  onMoveToTrash?: (path: string) => void;
  onRename?: (path: string) => void;
  browse?: SidebarBrowseSection;
  /** Shown above the shortcut hints, such as an available update. */
  notice?: ReactNode;
}) {
  const contextMenuPathRef = useRef<string | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const openSectionRef = useRef<HTMLElement>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  const openCollapsed = browse?.openSectionCollapsed ?? false;
  const browseCollapsed = browse?.browseSectionCollapsed ?? false;
  const splitActive = Boolean(browse) && !openCollapsed && !browseCollapsed;
  const openHeight =
    dragHeight ?? browse?.openSectionHeight ?? DEFAULT_OPEN_SECTION_HEIGHT;

  function clampOpenHeight(height: number) {
    const asideHeight = asideRef.current?.clientHeight ?? 0;
    const max = Math.max(
      MIN_OPEN_SECTION_HEIGHT,
      asideHeight - MIN_BROWSE_SECTION_HEIGHT,
    );
    return Math.round(Math.min(max, Math.max(MIN_OPEN_SECTION_HEIGHT, height)));
  }

  const fileCount = (
    <span
      title={`${files.length} open ${files.length === 1 ? "file" : "files"}`}
      className="text-[0.68rem] tabular-nums text-stone-400 dark:text-stone-500"
    >
      {files.length}
    </span>
  );

  return (
    <aside
      ref={asideRef}
      id="open-file-sidebar"
      aria-label="Open files"
      className="flex h-screen w-[var(--roughdraft-sidebar-width)] shrink-0 flex-col border-r border-stone-200 bg-[#F6F6F3] text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50"
      data-testid="open-file-sidebar"
    >
      <section
        ref={openSectionRef}
        aria-label="Open documents"
        className={cn(
          "flex min-h-0 flex-col",
          !browse || browseCollapsed ? "flex-1" : "shrink-0",
        )}
        style={splitActive ? { height: openHeight } : undefined}
        data-testid="open-file-sidebar-open-section"
      >
        <SectionHeader
          title="Open"
          expanded={browse ? !openCollapsed : null}
          onToggle={browse?.onToggleOpenSection}
          className={browse ? "h-12" : undefined}
        >
          {fileCount}
        </SectionHeader>

        {openCollapsed ? null : (
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
                      contextMenuPathRef.current =
                        item.dataset.filePath ?? null;
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
                                  active &&
                                    "text-stone-700 dark:text-stone-200",
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
                {onRename ? (
                  <ContextMenuItem
                    data-testid="open-file-sidebar-rename"
                    onClick={() => {
                      const path = contextMenuPathRef.current;
                      if (path && files.some((file) => file.path === path)) {
                        onRename(path);
                      }
                    }}
                  >
                    <Pencil className="size-3.5 text-stone-500 dark:text-slate-400" />
                    Rename…
                  </ContextMenuItem>
                ) : null}
                {onMoveToTrash ? (
                  <ContextMenuItem
                    data-testid="open-file-sidebar-move-to-trash"
                    onClick={() => {
                      const path = contextMenuPathRef.current;
                      if (path && files.some((file) => file.path === path)) {
                        onMoveToTrash(path);
                      }
                    }}
                  >
                    <Trash2 className="size-3.5 text-stone-500 dark:text-slate-400" />
                    Move to Trash
                  </ContextMenuItem>
                ) : null}
              </ContextMenuContent>
            </ContextMenu>
            {files.length === 0 ? (
              <p className="px-2 py-1 text-[0.7rem] text-stone-400 dark:text-stone-500">
                No open documents.
              </p>
            ) : null}
          </nav>
        )}
      </section>

      {browse && splitActive ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize open documents and browser"
          aria-valuenow={openHeight}
          tabIndex={0}
          data-testid="sidebar-section-divider"
          className="group relative z-10 -my-[3px] h-[7px] shrink-0 cursor-row-resize outline-none"
          onPointerDown={(event) => {
            event.preventDefault();
            const top =
              openSectionRef.current?.getBoundingClientRect().top ?? 0;
            const target = event.currentTarget;
            target.setPointerCapture(event.pointerId);
            let latest = openHeight;
            const handleMove = (moveEvent: PointerEvent) => {
              latest = clampOpenHeight(moveEvent.clientY - top);
              setDragHeight(latest);
            };
            const handleUp = () => {
              target.removeEventListener("pointermove", handleMove);
              target.removeEventListener("pointerup", handleUp);
              target.removeEventListener("pointercancel", handleUp);
              setDragHeight(null);
              browse.onOpenSectionHeightChange(latest);
            };
            target.addEventListener("pointermove", handleMove);
            target.addEventListener("pointerup", handleUp);
            target.addEventListener("pointercancel", handleUp);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            browse.onOpenSectionHeightChange(
              clampOpenHeight(
                openHeight + (event.key === "ArrowUp" ? -24 : 24),
              ),
            );
          }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-[3px] h-px bg-stone-200 group-hover:top-[2.5px] group-hover:h-0.5 group-hover:bg-blue-500 group-focus-visible:h-0.5 group-focus-visible:bg-blue-500 dark:bg-slate-800 dark:group-hover:bg-blue-400"
          />
        </div>
      ) : null}

      {browse ? (
        <section
          aria-label="Browse"
          className={cn(
            "flex min-h-0 flex-col",
            browseCollapsed ? "shrink-0" : "flex-1",
            (openCollapsed || browseCollapsed) &&
              "border-t border-stone-200 dark:border-slate-800",
          )}
          data-testid="file-browser-section"
        >
          <SectionHeader
            title="Browse"
            expanded={!browseCollapsed}
            onToggle={browse.onToggleBrowseSection}
          />
          {browseCollapsed ? null : (
            <nav
              aria-label="Markdown files"
              className="min-h-0 flex-1 overflow-y-auto p-1.5"
            >
              {browse.content}
            </nav>
          )}
        </section>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mx-2 mb-1 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[0.68rem] leading-4 text-red-700 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-300"
          data-testid="open-file-switch-error"
        >
          {error}
        </div>
      ) : null}

      {notice}

      <div className="flex items-center justify-between gap-2 border-t border-stone-200 px-3 py-2 text-[0.62rem] leading-4 text-stone-400 dark:border-slate-800 dark:text-stone-500">
        <span>
          <span aria-hidden="true">⌘W</span> close
        </span>
        <span>
          <span aria-hidden="true">⌘⌥←→</span> step
        </span>
        <span>
          <span aria-hidden="true">⌘P</span> switch
        </span>
      </div>
    </aside>
  );
}
