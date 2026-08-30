import { FileX } from "lucide-react";
import { getPathLeaf } from "./app-navigation";
import { Button } from "./components/ui/button";

type MissingFilePanelProps = {
  path: string;
  disabled?: boolean;
  canLocate: boolean;
  onLocate: () => void;
  onClose: () => void;
};

export function MissingFilePanel({
  path,
  disabled = false,
  canLocate,
  onLocate,
  onClose,
}: MissingFilePanelProps) {
  const filename = getPathLeaf(path) ?? path;

  return (
    <div
      data-testid="missing-file-panel"
      role="alert"
      className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-[#FCFCFC] p-6 dark:bg-background"
    >
      <div className="w-full max-w-md">
        <FileX
          aria-hidden="true"
          className="size-8 text-muted-foreground/70"
          strokeWidth={1.5}
        />
        <h1 className="mt-4 text-lg font-semibold">File not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{filename}</span> is no
          longer at
        </p>
        <p
          data-testid="missing-file-path"
          className="mt-1 font-mono text-xs break-all text-muted-foreground"
        >
          {path}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          It may have been moved, renamed, or deleted.
        </p>
        <div className="mt-5 flex items-center gap-2">
          {canLocate ? (
            <Button
              data-testid="missing-file-locate"
              disabled={disabled}
              onClick={onLocate}
            >
              Locate file…
            </Button>
          ) : null}
          <Button
            data-testid="missing-file-close"
            variant={canLocate ? "outline" : "default"}
            disabled={disabled}
            onClick={onClose}
          >
            Close file
          </Button>
          <span className="text-xs text-muted-foreground">⌘W</span>
        </div>
      </div>
    </div>
  );
}
