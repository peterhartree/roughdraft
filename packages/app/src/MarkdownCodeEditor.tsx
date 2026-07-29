import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { findTextRanges, getDocumentFindActiveIndex } from "./document-find";
import type {
  DocumentEditorViewController,
  DocumentEditorViewState,
} from "./document-view-state";
import { getDocumentEditorSelectionForMode } from "./document-view-state";
import { cn } from "./lib/utils";

interface CodeDocumentFindState {
  query: string;
  activeIndex: number;
  total: number;
  decorations: DecorationSet;
}

const setCodeDocumentFindState = StateEffect.define<{
  query: string;
  activeIndex: number;
}>();

function createCodeDocumentFindState(
  documentText: string,
  query: string,
  activeIndex: number,
): CodeDocumentFindState {
  const matches = findTextRanges(documentText, query);
  const safeActiveIndex =
    matches.length === 0 ? -1 : Math.min(activeIndex, matches.length - 1);
  const decorations = Decoration.set(
    matches.map((match, index) =>
      Decoration.mark({
        class:
          index === safeActiveIndex
            ? "document-find-match document-find-match-active"
            : "document-find-match",
        attributes: {
          "data-testid":
            index === safeActiveIndex
              ? "document-find-match-active"
              : "document-find-match",
        },
      }).range(match.from, match.to),
    ),
    true,
  );

  return {
    query,
    activeIndex: safeActiveIndex,
    total: matches.length,
    decorations,
  };
}

const EMPTY_CODE_DOCUMENT_FIND_STATE: CodeDocumentFindState = {
  query: "",
  activeIndex: -1,
  total: 0,
  decorations: Decoration.none,
};

const codeDocumentFindStateField = StateField.define<CodeDocumentFindState>({
  create: () => EMPTY_CODE_DOCUMENT_FIND_STATE,
  update: (value, transaction) => {
    const effect = transaction.effects.find((candidate) =>
      candidate.is(setCodeDocumentFindState),
    );
    if (!effect && (!transaction.docChanged || !value.query)) return value;

    const query = effect?.value.query ?? value.query;
    if (!query) return EMPTY_CODE_DOCUMENT_FIND_STATE;

    return createCodeDocumentFindState(
      transaction.state.doc.toString(),
      query,
      effect?.value.activeIndex ?? value.activeIndex,
    );
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

interface MarkdownCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  readOnly?: boolean;
  className?: string;
  testId?: string;
  onViewControllerChange?: (
    controller: DocumentEditorViewController | null,
  ) => void;
}

export function createMarkdownCodeEditorExtensions(
  readOnly: boolean,
  onDocumentChange: (value: string) => void,
  lastValueRef: { current: string },
): Extension[] {
  return [
    basicSetup,
    yamlFrontmatter({ content: markdown() }),
    EditorView.lineWrapping,
    codeDocumentFindStateField,
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;

      const nextValue = update.state.doc.toString();
      if (nextValue === lastValueRef.current) return;

      lastValueRef.current = nextValue;
      onDocumentChange(nextValue);
    }),
    EditorView.theme({
      "&": {
        backgroundColor: "transparent",
        color: "inherit",
        fontFamily:
          'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: "0.95rem",
      },
      ".cm-scroller": {
        fontFamily: "inherit",
        lineHeight: "1.75",
        overflow: "auto",
      },
      ".cm-content": {
        minHeight: "70vh",
        padding: "0",
      },
      ".cm-line": {
        padding: "0",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        border: "none",
        color: "rgb(148 163 184)",
        marginRight: "0.75rem",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "var(--cm-selection-bg, rgb(224 242 254))",
      },
      ".cm-gutterElement": {
        padding: "0 0.5rem 0 0",
      },
      ".cm-foldGutter": {
        display: "none",
      },
      ".cm-activeLine": {
        backgroundColor: "transparent",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "rgb(100 116 139)",
      },
      "&.cm-focused": {
        outline: "none",
      },
    }),
  ];
}

export function MarkdownCodeEditor({
  value,
  onChange,
  autoFocus = false,
  readOnly = false,
  className,
  testId,
  onViewControllerChange,
}: MarkdownCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef(value);
  const lastValueRef = useRef(value);
  const onViewControllerChangeRef = useRef(onViewControllerChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onViewControllerChangeRef.current = onViewControllerChange;
  }, [onViewControllerChange]);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) return;

    const view = new EditorView({
      parent: hostElement,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: createMarkdownCodeEditorExtensions(
          readOnly,
          (nextValue) => onChangeRef.current(nextValue),
          lastValueRef,
        ),
      }),
    });

    editorViewRef.current = view;
    lastValueRef.current = view.state.doc.toString();

    const viewController: DocumentEditorViewController = {
      capture: () => ({
        mode: "code",
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
      }),
      restore: (state: DocumentEditorViewState | null) => {
        const documentLength = view.state.doc.length;
        const selection = getDocumentEditorSelectionForMode(
          state,
          "code",
          documentLength,
        );
        const anchor = selection?.anchor ?? 0;
        const head = selection?.head ?? anchor;
        view.dispatch({ selection: { anchor, head } });
        view.focus();
      },
      find: (query, direction) => {
        const findState = view.state.field(codeDocumentFindStateField);
        const matches = findTextRanges(view.state.doc.toString(), query);
        const previousIndex =
          findState.query === query ? findState.activeIndex : -1;
        const activeIndex = getDocumentFindActiveIndex(
          previousIndex,
          matches.length,
          direction,
        );
        const activeMatch = matches[activeIndex];

        view.dispatch({
          effects: [
            setCodeDocumentFindState.of({ query, activeIndex }),
            ...(activeMatch
              ? [
                  EditorView.scrollIntoView(activeMatch.from, {
                    y: "center",
                  }),
                ]
              : []),
          ],
          selection: activeMatch
            ? { anchor: activeMatch.from, head: activeMatch.to }
            : undefined,
        });

        return { activeIndex, total: matches.length };
      },
      clearFind: () => {
        view.dispatch({
          effects: setCodeDocumentFindState.of({
            query: "",
            activeIndex: -1,
          }),
        });
      },
      getFindResult: () => {
        const findState = view.state.field(codeDocumentFindStateField);
        return {
          activeIndex: findState.activeIndex,
          total: findState.total,
        };
      },
    };
    onViewControllerChangeRef.current?.(viewController);

    if (autoFocus) {
      view.focus();
    }

    return () => {
      onViewControllerChangeRef.current?.(null);
      editorViewRef.current = null;
      view.destroy();
    };
  }, [autoFocus, readOnly]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      lastValueRef.current = value;
      return;
    }

    lastValueRef.current = value;
    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value,
      },
    });
  }, [value]);

  return (
    <div
      ref={hostRef}
      className={cn("markdown-code-editor", className)}
      data-testid={testId}
    />
  );
}
