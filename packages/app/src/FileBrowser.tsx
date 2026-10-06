import {
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  Pin,
  PinOff,
  Trash2,
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
  getPinnedNodesInTree,
} from "./file-browser";
import { cn } from "./lib/utils";
import type { TreeLoadState } from "./useFileBrowser";

const TREE_INDENT_REM = 0.75;

interface ContextTarget {
  path: string;
  kind: "file" | "directory";
  isRoot: boolean;
}

interface FileBrowserProps {
  project: TreeLoadState | null;
  projectRootIsPinned: boolean;
  pinnedRoots: string[];
  pins: Record<string, TreeLoadState>;
  projectPins: string[];
  activePath: string | null;
  openPaths: Set<string>;
  disabled: boolean;
  isFolderOpen: (folder: string, isRoot: boolean) => boolean;
  onToggleFolder: (folder: string, isRoot: boolean) => void;
  onOpenFile: (path: string, modifiedAt: number) => void;
  onPinProject: (folder: string) => void;
  onUnpinProject: (folder: string) => void;
  onPinToProject: (path: string) => void;
  onUnpinFromProject: (path: string) => void;
  onMoveToTrash: (path: string) => void;
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

function PinMarker() {
  return (
    <Pin
      className="size-3 shrink-0 fill-current text-stone-400 dark:text-stone-500"
      aria-label="Pinned"
    />
  );
}

const rowClassName =
  "h-[1.625rem] w-full max-w-full justify-start gap-1.5 overflow-hidden rounded-[0.3rem] pr-2 text-left text-[0.78rem] font-normal hover:bg-stone-200/75 dark:hover:bg-slate-800";
const activeRowClassName =
  "bg-white font-medium text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:bg-white dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-800";
// The ghost variant tints aria-expanded buttons; folder rows only signal
// expansion with the chevron.
const folderRowClassName =
  "aria-expanded:bg-transparent aria-expanded:hover:bg-stone-200/75 dark:aria-expanded:hover:bg-slate-800";
const hintClassName =
  "min-w-0 truncate text-[0.64rem] font-normal text-stone-400 dark:text-stone-500";

function relativeParent(rootPath: string, path: string) {
  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent.length > rootPath.length
    ? parent.slice(rootPath.length + 1)
    : "";
}

export function FileBrowser({
  project,
  projectRootIsPinned,
  pinnedRoots,
  pins,
  projectPins,
  activePath,
  openPaths,
  disabled,
  isFolderOpen,
  onToggleFolder,
  onOpenFile,
  onPinProject,
  onUnpinProject,
  onPinToProject,
  onUnpinFromProject,
  onMoveToTrash,
  onCopyPath,
}: FileBrowserProps) {
  const contextTargetRef = useRef<ContextTarget | null>(null);
  const projectPinSet = new Set(projectPins);

  function renderNodes(nodes: FileBrowserNode[], depth: number) {
    return (
      <ul className="m-0 list-none p-0">
        {nodes.map((node) => (
          <li key={node.path} className="min-w-0">
            {node.kind === "directory"
              ? renderDirectory(node, depth)
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
    pinnedHint?: string,
  ) {
    const active = path === activePath;
    const pinned = pinnedHint !== undefined;
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
            pinned && "max-w-[70%] shrink-0",
            (active || openPaths.has(path)) &&
              "text-slate-950 dark:text-slate-50",
          )}
        >
          {name}
        </span>
        {pinned ? (
          <>
            <span className={hintClassName}>{pinnedHint}</span>
            <span className="ml-auto" />
            <PinMarker />
          </>
        ) : null}
      </Button>
    );
  }

  function renderPinnedNodes(directory: FileBrowserDirectory, depth: number) {
    const pinnedNodes = getPinnedNodesInTree(directory, projectPins);
    if (pinnedNodes.length === 0) return null;
    return (
      <>
        <ul
          className="m-0 list-none p-0"
          aria-label={`Pinned in ${directory.name}`}
          data-testid="file-browser-project-pins"
        >
          {pinnedNodes.map((node) => {
            const hint = relativeParent(directory.path, node.path);
            return (
              <li key={node.path} className="min-w-0">
                {node.kind === "directory"
                  ? renderDirectory(node, depth, { pinnedHint: hint })
                  : renderFile(
                      node.path,
                      node.name,
                      node.modifiedAt,
                      depth,
                      hint,
                    )}
              </li>
            );
          })}
        </ul>
        <div
          className="my-1 mr-1.5 ml-6 h-px bg-stone-200 dark:bg-slate-800"
          aria-hidden="true"
        />
      </>
    );
  }

  function renderDirectory(
    directory: FileBrowserDirectory,
    depth: number,
    options: {
      isRoot?: boolean;
      rootIcon?: "git" | "folder" | "pin";
      truncated?: boolean;
      pinnedHint?: string;
    } = {},
  ) {
    const { isRoot = false, rootIcon, truncated, pinnedHint } = options;
    const pinned = pinnedHint !== undefined;
    const open = isFolderOpen(directory.path, isRoot);
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
          data-browser-root={isRoot ? "true" : undefined}
          className={cn(
            rowClassName,
            folderRowClassName,
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
              pinned && "max-w-[70%] shrink-0",
              isRoot &&
                "max-w-[72%] shrink-0 font-semibold text-slate-950 dark:text-slate-50",
            )}
          >
            {directory.name}
          </span>
          {pinned ? (
            <>
              <span className={hintClassName}>{pinnedHint}</span>
              <span className="ml-auto" />
              <PinMarker />
            </>
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
            {isRoot ? renderPinnedNodes(directory, depth + 1) : null}
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
              data-browser-root="true"
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
        {renderDirectory(tree, 0, {
          isRoot: true,
          rootIcon: kind === "pin" ? "pin" : listing.kind,
          truncated: listing.truncated,
        })}
        {tree.children.length === 0 && isFolderOpen(tree.path, true) ? (
          <EmptyNote>No Markdown files here.</EmptyNote>
        ) : null}
      </div>
    );
  }

  function renderProjectGroup() {
    if (!activePath) {
      return <EmptyNote>Open a document to browse its project here.</EmptyNote>;
    }
    const projectRoot = project?.listing?.root ?? null;
    if (projectRoot && projectRootIsPinned) {
      return (
        <EmptyNote>{`${getPathLeaf(projectRoot) ?? projectRoot} is pinned above.`}</EmptyNote>
      );
    }
    return renderRoot(projectRoot ?? "", project, "project");
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
                isRoot: target.dataset.browserRoot === "true",
              };
            }}
          >
            {pinnedRoots.length > 0 ? (
              <>
                <GroupLabel>Pinned</GroupLabel>
                {pinnedRoots.map((root) => renderRoot(root, pins[root], "pin"))}
              </>
            ) : null}
            <GroupLabel>Project</GroupLabel>
            {renderProjectGroup()}
          </div>
        }
      />
      <ContextMenuContent
        aria-label="File actions"
        data-open-file-sidebar-context-menu=""
      >
        <FileBrowserMenuItems
          targetRef={contextTargetRef}
          pinnedRoots={pinnedRoots}
          projectPinSet={projectPinSet}
          onPinProject={onPinProject}
          onUnpinProject={onUnpinProject}
          onPinToProject={onPinToProject}
          onUnpinFromProject={onUnpinFromProject}
          onMoveToTrash={onMoveToTrash}
          onCopyPath={onCopyPath}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

const menuIconClassName = "size-3.5 text-stone-500 dark:text-slate-400";

function FileBrowserMenuItems({
  targetRef,
  pinnedRoots,
  projectPinSet,
  onPinProject,
  onUnpinProject,
  onPinToProject,
  onUnpinFromProject,
  onMoveToTrash,
  onCopyPath,
}: {
  targetRef: React.RefObject<ContextTarget | null>;
  pinnedRoots: string[];
  projectPinSet: Set<string>;
  onPinProject: (folder: string) => void;
  onUnpinProject: (folder: string) => void;
  onPinToProject: (path: string) => void;
  onUnpinFromProject: (path: string) => void;
  onMoveToTrash: (path: string) => void;
  onCopyPath: (path: string) => void | Promise<void>;
}) {
  const target = targetRef.current;
  if (!target) return null;

  const pinnedAsProject = pinnedRoots.includes(target.path);
  const pinnedInProject = projectPinSet.has(target.path);
  return (
    <>
      {target.isRoot ? (
        <ContextMenuItem
          data-testid={
            pinnedAsProject ? "file-browser-unpin" : "file-browser-pin"
          }
          onClick={() =>
            pinnedAsProject
              ? onUnpinProject(target.path)
              : onPinProject(target.path)
          }
        >
          {pinnedAsProject ? (
            <PinOff className={menuIconClassName} />
          ) : (
            <Pin className={menuIconClassName} />
          )}
          {pinnedAsProject ? "Unpin project" : "Pin project"}
        </ContextMenuItem>
      ) : (
        <ContextMenuItem
          data-testid={
            pinnedInProject
              ? "file-browser-unpin-from-top"
              : "file-browser-pin-to-top"
          }
          onClick={() =>
            pinnedInProject
              ? onUnpinFromProject(target.path)
              : onPinToProject(target.path)
          }
        >
          {pinnedInProject ? (
            <PinOff className={menuIconClassName} />
          ) : (
            <Pin className={menuIconClassName} />
          )}
          {pinnedInProject ? "Unpin from top" : "Pin to top"}
        </ContextMenuItem>
      )}
      <ContextMenuItem
        data-testid="file-browser-copy-path"
        onClick={() => void onCopyPath(target.path)}
      >
        <Copy className={menuIconClassName} />
        Copy path
      </ContextMenuItem>
      {target.kind === "file" ? (
        <ContextMenuItem
          data-testid="file-browser-move-to-trash"
          onClick={() => onMoveToTrash(target.path)}
        >
          <Trash2 className={menuIconClassName} />
          Move to Trash
        </ContextMenuItem>
      ) : null}
    </>
  );
}
