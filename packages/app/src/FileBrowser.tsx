import {
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  Pin,
  PinOff,
} from "lucide-react";
import { useRef } from "react";
import { abbreviateDisplayPath, getPathLeaf } from "./app-navigation";
import { Button } from "./components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./components/ui/context-menu";
import {
  buildFileBrowserTree,
  type FileBrowserDirectory,
  type FileBrowserNode,
} from "./file-browser";
import { cn } from "./lib/utils";
import type { TreeLoadState } from "./useFileBrowser";

const TREE_INDENT_REM = 0.75;

interface FileBrowserProps {
  project: TreeLoadState | null;
  pinnedRoots: string[];
  pins: Record<string, TreeLoadState>;
  pinnedFolders: string[];
  activePath: string | null;
  openPaths: Set<string>;
  disabled: boolean;
  isFolderOpen: (folder: string, isRoot: boolean) => boolean;
  onToggleFolder: (folder: string, isRoot: boolean) => void;
  onOpenFile: (path: string, modifiedAt: number) => void;
  onPinFolder: (folder: string) => void;
  onUnpinFolder: (folder: string) => void;
  onCopyPath: (path: string) => void | Promise<void>;
}

function GroupLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pt-2 pb-1 text-[0.62rem] font-semibold tracking-[0.08em] text-stone-400 uppercase first:pt-0.5 dark:text-stone-500">
      {children}
    </div>
  );
}

function EmptyNote({ children }: { children: string }) {
  return (
    <p className="px-2 pb-2 text-[0.7rem] leading-4 text-stone-400 dark:text-stone-500">
      {children}
    </p>
  );
}

const rowClassName =
  "h-[1.625rem] w-full max-w-full justify-start gap-1.5 overflow-hidden rounded-[0.3rem] pr-2 text-left text-[0.78rem] font-normal hover:bg-stone-200/75 dark:hover:bg-slate-800";
const activeRowClassName =
  "bg-white font-medium text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:bg-white dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-800";

export function FileBrowser({
  project,
  pinnedRoots,
  pins,
  pinnedFolders,
  activePath,
  openPaths,
  disabled,
  isFolderOpen,
  onToggleFolder,
  onOpenFile,
  onPinFolder,
  onUnpinFolder,
  onCopyPath,
}: FileBrowserProps) {
  const contextTargetRef = useRef<{
    path: string;
    kind: "file" | "directory";
  } | null>(null);
  const pinnedSet = new Set(pinnedFolders);

  function renderNodes(nodes: FileBrowserNode[], depth: number) {
    return (
      <ul className="m-0 list-none p-0">
        {nodes.map((node) => (
          <li key={node.path} className="min-w-0">
            {node.kind === "directory"
              ? renderDirectory(node, depth, false)
              : renderFile(node.path, node.name, node.modifiedAt, depth)}
          </li>
        ))}
      </ul>
    );
  }

  function renderFile(
    path: string,
    name: string,
    modifiedAt: number,
    depth: number,
  ) {
    const active = path === activePath;
    return (
      <Button
        type="button"
        variant="ghost"
        title={path}
        aria-current={active ? "page" : undefined}
        aria-disabled={disabled && !active}
        data-testid="file-browser-file"
        data-browser-path={path}
        data-browser-kind="file"
        className={cn(
          rowClassName,
          "aria-disabled:opacity-50",
          active && activeRowClassName,
        )}
        style={{ paddingLeft: `${0.375 + depth * TREE_INDENT_REM}rem` }}
        onClick={() => {
          if (disabled && !active) return;
          onOpenFile(path, modifiedAt);
        }}
      >
        <span className="w-3.5 shrink-0" aria-hidden="true" />
        <FileText
          className={cn(
            "size-3.5 text-stone-400 dark:text-stone-500",
            active && "text-stone-700 dark:text-stone-200",
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "min-w-0 truncate text-stone-600 dark:text-stone-300",
            (active || openPaths.has(path)) &&
              "text-slate-950 dark:text-slate-50",
          )}
        >
          {name}
        </span>
      </Button>
    );
  }

  function renderDirectory(
    directory: FileBrowserDirectory,
    depth: number,
    isRoot: boolean,
    rootIcon?: "git" | "folder" | "pin",
    truncated?: boolean,
  ) {
    const open = isFolderOpen(directory.path, isRoot);
    const pinned = pinnedSet.has(directory.path);
    const FolderIcon = open ? FolderOpen : Folder;
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          title={directory.path}
          aria-expanded={open}
          data-testid={isRoot ? "file-browser-root" : "file-browser-folder"}
          data-browser-path={directory.path}
          data-browser-kind="directory"
          className={cn(
            rowClassName,
            // The ghost variant tints aria-expanded buttons; folder rows only
            // signal expansion with the chevron.
            "aria-expanded:bg-transparent aria-expanded:hover:bg-stone-200/75 dark:aria-expanded:hover:bg-slate-800",
            isRoot && "h-[1.875rem]",
          )}
          style={{ paddingLeft: `${0.375 + depth * TREE_INDENT_REM}rem` }}
          onClick={() => onToggleFolder(directory.path, isRoot)}
        >
          <ChevronRight
            className={cn(
              "size-3 text-stone-400 transition-transform duration-150 motion-reduce:transition-none dark:text-stone-500",
              open && "rotate-90",
            )}
            aria-hidden="true"
          />
          {rootIcon === "pin" ? (
            <Pin
              className="size-3.5 fill-current text-stone-400 dark:text-stone-500"
              aria-hidden="true"
            />
          ) : rootIcon === "git" ? (
            <FolderGit2
              className="size-3.5 text-stone-400 dark:text-stone-500"
              aria-hidden="true"
            />
          ) : (
            <FolderIcon
              className="size-3.5 text-stone-400 dark:text-stone-500"
              aria-hidden="true"
            />
          )}
          <span
            className={cn(
              "min-w-0 truncate text-stone-700 dark:text-stone-200",
              isRoot &&
                "max-w-[72%] shrink-0 font-semibold text-slate-950 dark:text-slate-50",
            )}
          >
            {directory.name}
          </span>
          {pinned && rootIcon !== "pin" ? (
            <Pin
              className="size-3 fill-current text-stone-400 dark:text-stone-500"
              aria-label="Pinned"
            />
          ) : null}
          {isRoot ? (
            <span className="ml-auto min-w-0 truncate pl-1.5 text-[0.64rem] font-normal text-stone-400 dark:text-stone-500">
              {abbreviateDisplayPath(
                directory.path.slice(0, directory.path.lastIndexOf("/")) || "/",
              )}
            </span>
          ) : null}
        </Button>
        {open ? (
          <>
            {renderNodes(directory.children, depth + 1)}
            {truncated ? (
              <p
                className="mt-1 mr-1.5 mb-1 ml-6 rounded-md bg-stone-200/60 px-2 py-1.5 text-[0.68rem] leading-4 text-stone-600 dark:bg-slate-800 dark:text-stone-300"
                data-testid="file-browser-truncated"
              >
                Showing the first 5,000 Markdown files. Pin a smaller folder to
                see the rest.
              </p>
            ) : null}
          </>
        ) : null}
      </>
    );
  }

  function renderRoot(
    rootPath: string,
    state: TreeLoadState | null | undefined,
    kind: "project" | "pin",
  ) {
    const listing = state?.listing ?? null;
    if (!listing) {
      return (
        <div key={rootPath}>
          {kind === "pin" ? (
            <div
              className="flex h-[1.875rem] items-center gap-1.5 px-1.5 text-[0.78rem] font-semibold"
              data-browser-path={rootPath}
              data-browser-kind="directory"
              title={rootPath}
            >
              <span className="w-3 shrink-0" aria-hidden="true" />
              <Pin
                className="size-3.5 fill-current text-stone-400 dark:text-stone-500"
                aria-hidden="true"
              />
              <span className="min-w-0 truncate">
                {getPathLeaf(rootPath) ?? rootPath}
              </span>
            </div>
          ) : null}
          <EmptyNote>
            {state?.status === "error"
              ? `Could not list this folder: ${state.error}`
              : "Loading…"}
          </EmptyNote>
        </div>
      );
    }

    const tree = buildFileBrowserTree(listing);
    return (
      <div key={rootPath} data-testid={`file-browser-${kind}-root`}>
        {renderDirectory(
          tree,
          0,
          true,
          kind === "pin" ? "pin" : listing.kind,
          listing.truncated,
        )}
        {tree.children.length === 0 && isFolderOpen(tree.path, true) ? (
          <EmptyNote>No Markdown files here.</EmptyNote>
        ) : null}
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            className="grid min-w-0 grid-cols-[minmax(0,1fr)]"
            data-testid="file-browser"
            onContextMenuCapture={(event) => {
              const target = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-browser-path]",
              );
              if (!target?.dataset.browserPath) {
                contextTargetRef.current = null;
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              contextTargetRef.current = {
                path: target.dataset.browserPath,
                kind:
                  target.dataset.browserKind === "directory"
                    ? "directory"
                    : "file",
              };
            }}
          >
            <GroupLabel>Project</GroupLabel>
            {activePath ? (
              renderRoot(project?.listing?.root ?? "", project, "project")
            ) : (
              <EmptyNote>Open a document to browse its project here.</EmptyNote>
            )}
            <GroupLabel>Pinned</GroupLabel>
            {pinnedRoots.length > 0 ? (
              pinnedRoots.map((root) => renderRoot(root, pins[root], "pin"))
            ) : (
              <EmptyNote>
                Right-click a folder and choose Pin folder to keep it here.
              </EmptyNote>
            )}
          </div>
        }
      />
      <ContextMenuContent
        aria-label="Folder actions"
        data-open-file-sidebar-context-menu=""
      >
        <FileBrowserMenuItems
          targetRef={contextTargetRef}
          pinnedSet={pinnedSet}
          onPinFolder={onPinFolder}
          onUnpinFolder={onUnpinFolder}
          onCopyPath={onCopyPath}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FileBrowserMenuItems({
  targetRef,
  pinnedSet,
  onPinFolder,
  onUnpinFolder,
  onCopyPath,
}: {
  targetRef: React.RefObject<{
    path: string;
    kind: "file" | "directory";
  } | null>;
  pinnedSet: Set<string>;
  onPinFolder: (folder: string) => void;
  onUnpinFolder: (folder: string) => void;
  onCopyPath: (path: string) => void | Promise<void>;
}) {
  const target = targetRef.current;
  if (!target) return null;
  const pinned = pinnedSet.has(target.path);
  return (
    <>
      {target.kind === "directory" ? (
        <ContextMenuItem
          data-testid={pinned ? "file-browser-unpin" : "file-browser-pin"}
          onClick={() =>
            pinned ? onUnpinFolder(target.path) : onPinFolder(target.path)
          }
        >
          {pinned ? (
            <PinOff className="size-3.5 text-stone-500 dark:text-slate-400" />
          ) : (
            <Pin className="size-3.5 text-stone-500 dark:text-slate-400" />
          )}
          {pinned ? "Unpin folder" : "Pin folder"}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem
        data-testid="file-browser-copy-path"
        onClick={() => void onCopyPath(target.path)}
      >
        <Copy className="size-3.5 text-stone-500 dark:text-slate-400" />
        Copy path
      </ContextMenuItem>
    </>
  );
}
