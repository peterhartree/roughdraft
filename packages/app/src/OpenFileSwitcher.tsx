import { FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { cn } from "./lib/utils";
import {
  filterOpenFiles,
  formatOpenFileParentPath,
  getOpenFileName,
  type OpenFileItem,
} from "./open-file-navigation";

export function OpenFileSwitcher({
  files,
  activePath,
  disabled,
  open,
  onOpenChange,
  onSelect,
}: {
  files: OpenFileItem[];
  activePath: string | null;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const matchingFiles = useMemo(
    () => filterOpenFiles(files, query),
    [files, query],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
  }, [open]);

  useEffect(() => {
    setSelectedIndex((current) =>
      Math.min(current, Math.max(matchingFiles.length - 1, 0)),
    );
  }, [matchingFiles.length]);

  const selectFile = async (path: string) => {
    if (disabled && path !== activePath) return;
    if (await onSelect(path)) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="open-file-switcher"
        className="top-[28%] gap-3 p-3 sm:max-w-md"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Open file</DialogTitle>
          <DialogDescription>
            Search the Markdown files open in this Roughdraft session.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((current) =>
                matchingFiles.length === 0
                  ? 0
                  : (current + 1) % matchingFiles.length,
              );
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex((current) =>
                matchingFiles.length === 0
                  ? 0
                  : (current - 1 + matchingFiles.length) % matchingFiles.length,
              );
              return;
            }
            if (event.key === "Enter") {
              const file = matchingFiles[selectedIndex];
              if (!file) return;
              event.preventDefault();
              void selectFile(file.path);
            }
          }}
          placeholder="Type a filename..."
          aria-label="Find an open file"
          data-testid="open-file-switcher-input"
        />

        <div className="max-h-72 overflow-y-auto">
          {matchingFiles.length > 0 ? (
            <ol className="grid list-none gap-0.5 p-0">
              {matchingFiles.map((file, index) => (
                <li key={file.path}>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={disabled && file.path !== activePath}
                    data-testid="open-file-switcher-option"
                    className={cn(
                      "h-auto w-full justify-start gap-2 px-2 py-2 text-left",
                      index === selectedIndex && "bg-muted",
                    )}
                    aria-current={file.path === activePath ? "page" : undefined}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => void selectFile(file.path)}
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {getOpenFileName(file.path)}
                      </span>
                      <span className="block truncate text-[0.68rem] text-muted-foreground">
                        {formatOpenFileParentPath(file.path)}
                      </span>
                    </span>
                    {file.unread ? (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400"
                        aria-hidden="true"
                      />
                    ) : null}
                  </Button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No open filenames match.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
