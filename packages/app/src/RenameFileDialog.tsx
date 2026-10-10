import { useEffect, useRef, useState } from "react";
import { getPathLeaf } from "./app-navigation";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";

/** Adds the .md extension when the name leaves it off. */
export function markdownFileNameFromInput(input: string): string {
  const name = input.trim();
  return name && !name.toLowerCase().endsWith(".md") ? `${name}.md` : name;
}

/**
 * Asks for a new name for one Markdown file. `onRename` resolves to an error
 * message to show, or null once the file has been renamed.
 */
export function RenameFileDialog({
  path,
  onRename,
  onClose,
}: {
  path: string | null;
  onRename: (path: string, name: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const currentName = (path && getPathLeaf(path)) ?? "";
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(currentName);
    setError(null);
    setPending(false);
  }, [currentName]);

  return (
    <Dialog
      open={path !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        data-testid="rename-file-dialog"
        initialFocus={inputRef}
        showCloseButton={false}
      >
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!path || pending) return;
            const nextName = markdownFileNameFromInput(name);
            if (nextName === currentName) {
              onClose();
              return;
            }
            setPending(true);
            setError(null);
            const message = await onRename(path, nextName);
            setPending(false);
            if (message) {
              setError(message);
              inputRef.current?.focus();
              return;
            }
            onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
          </DialogHeader>
          <Input
            ref={inputRef}
            aria-label="File name"
            aria-invalid={error ? true : undefined}
            data-testid="rename-file-input"
            value={name}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onFocus={(event) => {
              // Select the name without its extension, as Finder does.
              const input = event.currentTarget;
              if (input.value !== currentName) return;
              const stemLength = currentName.toLowerCase().endsWith(".md")
                ? currentName.length - 3
                : currentName.length;
              input.setSelectionRange(0, stemLength);
            }}
          />
          {error ? (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="rename-file-error"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              className="h-11 px-4 sm:h-7 sm:px-2"
              disabled={pending}
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              className="h-11 px-4 sm:h-7 sm:px-2"
              disabled={pending || !name.trim()}
              type="submit"
              data-testid="rename-file-submit"
            >
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
