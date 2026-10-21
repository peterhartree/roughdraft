import type { DocumentInteractionMode } from "./PageCard";

interface InteractionModeShortcutEvent {
  code: string;
  key: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  target: unknown;
}

export type DocumentFindShortcutAction =
  | "open"
  | "replace"
  | "next"
  | "previous";

const FORM_CONTROL_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isFormControl(target: unknown): boolean {
  if (!target || typeof target !== "object" || !("tagName" in target)) {
    return false;
  }

  return FORM_CONTROL_TAGS.has(
    String((target as { tagName: unknown }).tagName).toUpperCase(),
  );
}

function isApplePlatform(platform?: string | null) {
  return !!platform && /mac|iphone|ipad|ipod/i.test(platform);
}

export function matchesCopyPathShortcut(
  event: InteractionModeShortcutEvent,
  platform?: string | null,
): boolean {
  const hasPrimaryModifier = platform
    ? isApplePlatform(platform)
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey
    : event.metaKey !== event.ctrlKey;

  return (
    event.code === "KeyC" &&
    hasPrimaryModifier &&
    event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    !event.isComposing &&
    !isFormControl(event.target)
  );
}

export function getDocumentFindShortcutAction(
  event: InteractionModeShortcutEvent,
  platform?: string | null,
): DocumentFindShortcutAction | null {
  const key = event.key.toLocaleLowerCase();
  if (!event.repeat && !event.isComposing && !event.shiftKey) {
    if (
      event.metaKey &&
      event.altKey &&
      !event.ctrlKey &&
      event.code === "KeyF"
    ) {
      return "replace";
    }
    if (
      !isApplePlatform(platform) &&
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      key === "h"
    ) {
      return "replace";
    }
  }
  const isPrimaryShortcut =
    event.metaKey !== event.ctrlKey &&
    !event.altKey &&
    !event.repeat &&
    !event.isComposing;

  if (!isPrimaryShortcut) return null;
  if (key === "f" && event.metaKey && event.shiftKey) return "replace";
  if (key === "f" && !event.shiftKey) return "open";
  if (key !== "g") return null;
  return event.shiftKey ? "previous" : "next";
}

export function getInteractionModeShortcutTarget(
  event: InteractionModeShortcutEvent,
  currentMode: DocumentInteractionMode,
): DocumentInteractionMode | null {
  const isShortcut =
    event.code === "KeyS" &&
    event.metaKey &&
    event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.repeat &&
    !event.isComposing;

  if (!isShortcut || isFormControl(event.target) || currentMode === "viewing") {
    return null;
  }

  return currentMode === "editing" ? "suggesting" : "editing";
}
