import { Extension, type JSONContent, Node } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ChevronUp, Maximize2, Minimize2, Minus } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "./components/ui/button";
import {
  type DocumentNotesRead,
  formatSectionLink,
  headingSlug,
  normalizeNotes,
  parseNoteLine,
} from "./document-notes";
import {
  buildDocumentOutline,
  getActiveOutlineItemIndex,
} from "./document-outline";
import { cn } from "./lib/utils";

const EDITOR_SELECTOR = ".document-rich-text-layout .tiptap";
const HEADING_SELECTOR = [1, 2, 3, 4, 5, 6]
  .map((level) => `:scope > h${level}`)
  .join(", ");
const HEADER_SELECTOR = '[data-testid="document-page-header"]';
/** Matches the outline's landing line, so both jump to the same place. */
const READING_LINE_OFFSET = 32;
const JUMP_OFFSET = 16;
const DOCK_PREFERENCES_KEY = "roughdraft.notes-dock.v1";
const SHORTCUT_LABEL = "⌘⇧J";

type DockSize = "minimized" | "open" | "tall";

interface DocumentSection {
  label: string;
  slug: string;
  element: HTMLElement;
}

interface PickerState {
  from: number;
  query: string;
  selected: number;
}

interface GhostState {
  section: DocumentSection;
  top: number;
}

function readDockSize(): DockSize {
  try {
    const stored = window.localStorage.getItem(DOCK_PREFERENCES_KEY);
    const size = stored
      ? (JSON.parse(stored) as { size?: unknown }).size
      : null;
    return size === "open" || size === "tall" ? size : "minimized";
  } catch {
    return "minimized";
  }
}

function writeDockSize(size: DockSize) {
  try {
    window.localStorage.setItem(DOCK_PREFERENCES_KEY, JSON.stringify({ size }));
  } catch {
    // Storage can be unavailable; the size then lasts for this session only.
  }
}

/** A link to a document section, shown as a chip. */
const SectionTag = Node.create({
  name: "sectionTag",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { label: { default: "" }, slug: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-section-tag]" }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-section-tag": "",
        "data-testid": "notes-dock-tag",
        "data-slug": node.attrs.slug,
        class: "notes-dock-tag",
        title: "Go to section",
      },
      `§ ${node.attrs.label}`,
    ];
  },
});

/**
 * Remembers which section was being read when a line was started, so a tag is
 * offered only for lines written about that section. Not saved.
 */
const LineSection = Extension.create({
  name: "lineSection",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          startedIn: { default: null, keepOnSplit: false, rendered: false },
        },
      },
    ];
  },
});

function notesToContent(notes: string): JSONContent {
  return {
    type: "doc",
    content: notes.split("\n").map((line) => {
      const content = parseNoteLine(line).map((part) =>
        part.type === "text"
          ? { type: "text", text: part.text }
          : {
              type: "sectionTag",
              attrs: { label: part.label, slug: part.slug },
            },
      );
      return content.length > 0
        ? { type: "paragraph", content }
        : { type: "paragraph" };
    }),
  };
}

function contentToNotes(doc: ProseMirrorNode): string {
  const lines: string[] = [];
  doc.forEach((paragraph) => {
    let line = "";
    paragraph.forEach((child) => {
      line +=
        child.type.name === "sectionTag"
          ? formatSectionLink(child.attrs.label, child.attrs.slug)
          : (child.text ?? "");
    });
    lines.push(line);
  });
  return normalizeNotes(lines.join("\n"));
}

function paragraphHasTag(paragraph: ProseMirrorNode) {
  let found = false;
  paragraph.forEach((child) => {
    if (child.type.name === "sectionTag") found = true;
  });
  return found;
}

function lastTagSlugBefore(doc: ProseMirrorNode, position: number) {
  let slug: string | null = null;
  doc.nodesBetween(0, position, (node) => {
    if (node.type.name === "sectionTag") slug = node.attrs.slug;
  });
  return slug;
}

/** `§` or `[[` before the caret, and what has been typed after it. */
function findPickerTrigger(editor: Editor) {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  const before = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    "￼",
  );
  const match = before.match(/(?:§|\[\[)([^￼§[\]]{0,40})$/);
  if (!match) return null;
  return { from: $from.pos - match[0].length, query: match[1] };
}

function useReadingSections(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const [sections, setSections] = useState<DocumentSection[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!enabled || !scroller) {
      setSections([]);
      return;
    }
    let frame = 0;
    const collect = () => {
      frame = 0;
      const editor = scroller.querySelector<HTMLElement>(EDITOR_SELECTOR);
      const elements = editor
        ? [...editor.querySelectorAll<HTMLElement>(HEADING_SELECTOR)]
        : [];
      const items = buildDocumentOutline(
        elements.map((element) => ({
          level: Number(element.tagName.slice(1)),
          text: element.textContent ?? "",
        })),
      );
      const next = items.map((item) => ({
        label: item.text,
        slug: headingSlug(item.text),
        element: elements[item.headingIndex],
      }));
      setSections((current) =>
        current.length === next.length &&
        current.every(
          (section, index) =>
            section.element === next[index].element &&
            section.label === next[index].label,
        )
          ? current
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(collect);
    };
    collect();
    const observer = new MutationObserver(schedule);
    observer.observe(scroller, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, scrollContainerRef]);

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!enabled || !scroller || sections.length === 0) {
      setActiveIndex(-1);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const scrollerRect = scroller.getBoundingClientRect();
      const header = scroller.querySelector<HTMLElement>(HEADER_SELECTOR);
      const atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const readingLine = atBottom
        ? scrollerRect.bottom - 1
        : scrollerRect.top + (header?.offsetHeight ?? 0) + READING_LINE_OFFSET;
      setActiveIndex(
        getActiveOutlineItemIndex(
          sections.map(
            (section) => section.element.getBoundingClientRect().top,
          ),
          readingLine,
        ),
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, scrollContainerRef, sections]);

  return { sections, active: sections[activeIndex] ?? null };
}

function NotesEditor({
  notes,
  onNotesChange,
  sections,
  active,
  onJump,
  focusRequest,
}: {
  notes: string;
  onNotesChange: (notes: string) => void;
  sections: DocumentSection[];
  active: DocumentSection | null;
  onJump: (slug: string, label: string) => void;
  focusRequest: number;
}) {
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const pickerRef = useRef(picker);
  pickerRef.current = picker;
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  const onNotesChangeRef = useRef(onNotesChange);
  onNotesChangeRef.current = onNotesChange;
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;
  const dismissedSlugRef = useRef<string | null>(null);
  const closedTriggerRef = useRef<number | null>(null);

  const pickerOptions = useCallback((query: string) => {
    const current = activeRef.current;
    const ordered = current
      ? [current, ...sectionsRef.current.filter((s) => s !== current)]
      : sectionsRef.current;
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? ordered.filter((s) => s.label.toLocaleLowerCase().includes(needle))
      : ordered;
  }, []);

  const updateGhost = useCallback(() => {
    const editor = editorRef.current;
    const section = activeRef.current;
    const body = bodyRef.current;
    if (!editor || !section || !body || !editor.isFocused) {
      setGhost(null);
      return;
    }
    const { selection, doc } = editor.state;
    const { $from } = selection;
    const paragraph = $from.parent;
    const blocked =
      !selection.empty ||
      pickerRef.current !== null ||
      paragraph.type.name !== "paragraph" ||
      paragraphHasTag(paragraph) ||
      (paragraph.textContent.trim() !== "" &&
        paragraph.attrs.startedIn !== section.slug) ||
      dismissedSlugRef.current === section.slug ||
      lastTagSlugBefore(doc, $from.before()) === section.slug;
    if (blocked) {
      setGhost(null);
      return;
    }
    const coords = editor.view.coordsAtPos($from.end());
    const bodyRect = body.getBoundingClientRect();
    setGhost({
      section,
      top: coords.bottom - bodyRect.top + body.scrollTop + 2,
    });
  }, []);

  const insertTag = useCallback(
    (section: DocumentSection, range?: { from: number; to: number }) => {
      const editor = editorRef.current;
      if (!editor) return;
      dismissedSlugRef.current = section.slug;
      const chain = editor.chain().focus();
      if (range) chain.deleteRange(range);
      chain
        .insertContent([
          {
            type: "sectionTag",
            attrs: { label: section.label, slug: section.slug },
          },
          { type: "text", text: " " },
        ])
        .run();
    },
    [],
  );

  const acceptGhost = useCallback(() => {
    const editor = editorRef.current;
    const current = ghostRef.current;
    if (!editor || !current) return;
    const { $from } = editor.state.selection;
    const end = $from.end();
    editor.commands.setTextSelection(end);
    const needsSpace =
      !/\s$/.test($from.parent.textContent) && $from.parent.textContent !== "";
    if (needsSpace) editor.commands.insertContent(" ");
    insertTag(current.section);
  }, [insertTag]);

  const choosePickerOption = useCallback(
    (index: number) => {
      const editor = editorRef.current;
      const current = pickerRef.current;
      if (!editor || !current) return;
      const section = pickerOptions(current.query)[index];
      if (!section) return;
      setPicker(null);
      insertTag(section, {
        from: current.from,
        to: editor.state.selection.from,
      });
    },
    [insertTag, pickerOptions],
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          dropcursor: false,
          gapcursor: false,
          hardBreak: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          link: false,
          listItem: false,
          listKeymap: false,
          orderedList: false,
          strike: false,
          trailingNode: false,
          underline: false,
        }),
        SectionTag,
        LineSection,
        Placeholder.configure({
          placeholder: "Notes to yourself. Type § to link a section.",
        }),
      ],
      content: notesToContent(notes),
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: "notes-dock-editor",
          "aria-label": "Notes",
          "data-testid": "notes-dock-editor",
        },
        handleClickOn: (_view, _pos, node) => {
          if (node.type.name !== "sectionTag") return false;
          onJumpRef.current(node.attrs.slug, node.attrs.label);
          return true;
        },
        handleKeyDown: (_view, event) => {
          const currentPicker = pickerRef.current;
          if (currentPicker) {
            const count = pickerOptions(currentPicker.query).length;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (count === 0) return false;
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setPicker({
                ...currentPicker,
                selected: (currentPicker.selected + step + count) % count,
              });
              return true;
            }
            if ((event.key === "Enter" || event.key === "Tab") && count > 0) {
              event.preventDefault();
              choosePickerOption(currentPicker.selected);
              return true;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              closedTriggerRef.current = currentPicker.from;
              setPicker(null);
              return true;
            }
          }
          const currentGhost = ghostRef.current;
          if (currentGhost && event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            acceptGhost();
            return true;
          }
          if (currentGhost && event.key === "Enter") {
            const editor = editorRef.current;
            if (editor?.state.selection.$from.parent.textContent.trim()) {
              dismissedSlugRef.current = currentGhost.section.slug;
            }
          }
          return false;
        },
      },
      onUpdate: ({ editor, transaction }) => {
        onNotesChangeRef.current(contentToNotes(editor.state.doc));

        const { $from } = editor.state.selection;
        const paragraph = $from.parent;
        const section = activeRef.current;
        if (
          section &&
          paragraph.type.name === "paragraph" &&
          paragraph.textContent.trim() !== "" &&
          !paragraph.attrs.startedIn
        ) {
          const position = $from.before();
          queueMicrotask(() => {
            if (editor.isDestroyed) return;
            const node = editor.state.doc.nodeAt(position);
            if (node?.type.name !== "paragraph" || node.attrs.startedIn) return;
            editor.view.dispatch(
              editor.state.tr
                .setNodeMarkup(position, undefined, {
                  ...node.attrs,
                  startedIn: section.slug,
                })
                .setMeta("addToHistory", false),
            );
          });
        }

        if (transaction.docChanged) {
          const trigger = findPickerTrigger(editor);
          if (trigger && trigger.from !== closedTriggerRef.current) {
            const previous = pickerRef.current;
            setPicker({
              ...trigger,
              selected:
                previous && previous.from === trigger.from
                  ? Math.min(
                      previous.selected,
                      Math.max(0, pickerOptions(trigger.query).length - 1),
                    )
                  : 0,
            });
          } else {
            setPicker(null);
          }
        }
      },
      onSelectionUpdate: ({ editor }) => {
        const current = pickerRef.current;
        if (current) {
          const trigger = findPickerTrigger(editor);
          if (!trigger || trigger.from !== current.from) setPicker(null);
        }
        updateGhost();
      },
      onFocus: () => updateGhost(),
      onBlur: () => {
        setGhost(null);
        setPicker(null);
      },
    },
    [],
  );
  editorRef.current = editor;

  // Take in notes changed elsewhere, such as in the file on disk.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (contentToNotes(editor.state.doc) === notes) return;
    editor.commands.setContent(notesToContent(notes), { emitUpdate: false });
  }, [editor, notes]);

  // Offer a tag for the new section as soon as the reader reaches it.
  useEffect(() => {
    activeRef.current = active;
    updateGhost();
  }, [active, updateGhost]);

  useEffect(() => {
    if (!editor || focusRequest === 0) return;
    editor.commands.focus("end");
  }, [editor, focusRequest]);

  const options = picker ? pickerOptions(picker.query) : [];
  const pickerPosition = useMemo(() => {
    if (!picker || !editor || editor.isDestroyed) return null;
    try {
      const coords = editor.view.coordsAtPos(picker.from);
      return { left: coords.left, bottom: window.innerHeight - coords.top + 6 };
    } catch {
      return null;
    }
  }, [editor, picker]);

  return (
    <div
      ref={bodyRef}
      className="relative min-h-0 flex-1 overflow-auto px-4 py-3"
    >
      <EditorContent editor={editor} className="h-full" />
      {ghost && !picker ? (
        <div
          className="pointer-events-none absolute left-4 flex items-center gap-1.5 rounded-md bg-white text-[11px] text-stone-400 dark:bg-slate-900 dark:text-slate-500"
          style={{ top: ghost.top }}
          data-testid="notes-dock-suggestion"
        >
          <span className="notes-dock-tag notes-dock-tag-ghost">
            § {ghost.section.label}
          </span>
          <kbd className="rounded border border-stone-200 px-1 font-sans dark:border-slate-700">
            Tab
          </kbd>
        </div>
      ) : null}
      {picker && pickerPosition
        ? createPortal(
            <div
              role="listbox"
              aria-label="Link a section"
              data-testid="notes-dock-section-picker"
              className="fixed z-50 w-72 rounded-lg border border-stone-200 bg-white p-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
              style={{
                left: Math.max(
                  8,
                  Math.min(pickerPosition.left, window.innerWidth - 296),
                ),
                bottom: pickerPosition.bottom,
              }}
            >
              {options.length === 0 ? (
                <p className="px-2 py-1.5 text-stone-500 dark:text-slate-400">
                  {sections.length === 0
                    ? "This document has no headings."
                    : "No matching section."}
                </p>
              ) : (
                options.map((section, index) => (
                  <div
                    key={`section-${sections.indexOf(section)}`}
                    role="option"
                    aria-selected={index === picker.selected}
                    tabIndex={-1}
                    className={cn(
                      "flex cursor-pointer items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-stone-800 dark:text-slate-200",
                      index === picker.selected &&
                        "bg-stone-100 dark:bg-slate-800",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choosePickerOption(index);
                    }}
                  >
                    <span className="min-w-0 truncate">{section.label}</span>
                    {section === active ? (
                      <span className="shrink-0 text-[11px] text-stone-400 dark:text-slate-500">
                        reading now
                      </span>
                    ) : null}
                  </div>
                ))
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function isNotesShortcut(event: KeyboardEvent) {
  return (
    event.code === "KeyJ" &&
    event.metaKey !== event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.repeat &&
    !event.isComposing
  );
}

/**
 * A scratchpad for the document, docked in the bottom-right corner like a
 * minimised email draft. Notes are saved in the frontmatter.
 */
export function NotesDock({
  notes,
  onNotesChange,
  scrollContainerRef,
  enabled,
}: {
  notes: DocumentNotesRead;
  onNotesChange: (notes: string) => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}) {
  const [size, setSize] = useState<DockSize>(readDockSize);
  const [focusRequest, setFocusRequest] = useState(0);
  const [flash, setFlash] = useState<{
    key: number;
    rect: DOMRect;
  } | null>(null);
  const [missingSection, setMissingSection] = useState<string | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const fallbackRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = scrollContainerRef ?? fallbackRef;
  const { sections, active } = useReadingSections(scrollerRef, enabled);

  const changeSize = useCallback((next: DockSize) => {
    setSize(next);
    writeDockSize(next);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isNotesShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const focusInDock = dockRef.current?.contains(document.activeElement);
      if (size === "minimized") {
        changeSize("open");
        setFocusRequest((count) => count + 1);
      } else if (focusInDock) {
        changeSize("minimized");
      } else {
        setFocusRequest((count) => count + 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [changeSize, enabled, size]);

  const jump = useCallback(
    (slug: string, label: string) => {
      const scroller = scrollerRef.current;
      const section =
        sections.find((candidate) => candidate.slug === slug) ??
        sections.find((candidate) => candidate.label === label);
      if (!scroller || !section?.element.isConnected) {
        setMissingSection(label);
        return;
      }
      setMissingSection(null);
      const header = scroller.querySelector<HTMLElement>(HEADER_SELECTOR);
      const top =
        section.element.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        (header?.offsetHeight ?? 0) -
        JUMP_OFFSET;
      scroller.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      setFlash((current) => ({
        key: (current?.key ?? 0) + 1,
        rect: section.element.getBoundingClientRect(),
      }));
    },
    [scrollerRef, sections],
  );

  useEffect(() => {
    if (!flash) return;
    const timeout = window.setTimeout(() => setFlash(null), 1200);
    return () => window.clearTimeout(timeout);
  }, [flash]);

  useEffect(() => {
    if (!missingSection) return;
    const timeout = window.setTimeout(() => setMissingSection(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [missingSection]);

  if (!enabled) return null;

  const notesText = notes.status === "ok" ? notes.notes : "";
  const peek =
    notesText
      .split("\n")
      .find((line) => line.trim())
      ?.replace(/\[§ ([^\]]+)\]\(#[^)]+\)/g, "§ $1") ?? "";
  const minimized = size === "minimized";

  return createPortal(
    <>
      {flash ? (
        <div
          key={flash.key}
          className="document-outline-flash pointer-events-none fixed z-30 rounded-md"
          style={{
            top: flash.rect.top - 4,
            left: flash.rect.left - 8,
            width: flash.rect.width + 16,
            height: flash.rect.height + 8,
          }}
        />
      ) : null}
      <section
        ref={dockRef}
        aria-label="Notes"
        data-testid="notes-dock"
        data-size={size}
        className={cn(
          "fixed right-2 bottom-0 left-2 z-40 flex flex-col overflow-hidden rounded-t-xl border border-b-0 border-stone-200 bg-white shadow-[0_8px_30px_rgba(28,25,23,0.16)] sm:left-auto sm:right-6 dark:border-slate-700 dark:bg-slate-900",
          minimized && "sm:w-72",
          size === "open" && "h-[min(440px,70vh)] sm:w-[400px]",
          size === "tall" && "h-[calc(100vh-72px)] sm:w-[460px]",
        )}
      >
        <header
          className="flex h-10 shrink-0 cursor-pointer items-center gap-1 bg-stone-900 pr-1.5 pl-3.5 text-stone-50 dark:bg-slate-800"
          onClick={() => changeSize(minimized ? "open" : "minimized")}
        >
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            Notes
            {minimized && peek ? (
              <span className="ml-2 font-normal text-stone-400">{peek}</span>
            ) : null}
          </span>
          {minimized ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-stone-300 hover:bg-white/10 hover:text-white"
              aria-label={`Open notes (${SHORTCUT_LABEL})`}
              title={`Open notes (${SHORTCUT_LABEL})`}
              data-testid="notes-dock-open"
              onClick={(event) => {
                event.stopPropagation();
                changeSize("open");
                setFocusRequest((count) => count + 1);
              }}
            >
              <ChevronUp aria-hidden="true" />
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-stone-300 hover:bg-white/10 hover:text-white"
                aria-label={`Minimise notes (${SHORTCUT_LABEL})`}
                title={`Minimise (${SHORTCUT_LABEL})`}
                data-testid="notes-dock-minimize"
                onClick={(event) => {
                  event.stopPropagation();
                  changeSize("minimized");
                }}
              >
                <Minus aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-stone-300 hover:bg-white/10 hover:text-white"
                aria-label={size === "tall" ? "Shrink notes" : "Expand notes"}
                title={size === "tall" ? "Shrink" : "Expand"}
                data-testid="notes-dock-expand"
                onClick={(event) => {
                  event.stopPropagation();
                  changeSize(size === "tall" ? "open" : "tall");
                }}
              >
                {size === "tall" ? (
                  <Minimize2 aria-hidden="true" />
                ) : (
                  <Maximize2 aria-hidden="true" />
                )}
              </Button>
            </>
          )}
        </header>
        {minimized ? null : notes.status === "ok" ? (
          <>
            <NotesEditor
              notes={notes.notes}
              onNotesChange={onNotesChange}
              sections={sections}
              active={active}
              onJump={jump}
              focusRequest={focusRequest}
            />
            <footer className="flex min-h-9 shrink-0 items-center border-t border-stone-200 px-3.5 text-xs text-stone-400 dark:border-slate-700 dark:text-slate-500">
              <span
                className="min-w-0 truncate"
                data-testid="notes-dock-reading"
              >
                {missingSection
                  ? `“${missingSection}” is no longer in the document.`
                  : active
                    ? `Reading § ${active.label}`
                    : null}
              </span>
            </footer>
          </>
        ) : (
          <p className="px-4 py-3 text-sm text-stone-600 dark:text-slate-300">
            {notes.reason}
          </p>
        )}
      </section>
    </>,
    document.body,
  );
}
