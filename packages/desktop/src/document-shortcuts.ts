interface DocumentShortcutInput {
  type: string;
  key: string;
  code: string;
  meta: boolean;
  alt: boolean;
  control: boolean;
  shift: boolean;
  isAutoRepeat: boolean;
  isComposing: boolean;
}

export function shouldSuppressNativeCloseShortcut(
  input: DocumentShortcutInput,
  currentUrl: string,
  validatedOrigin: string | null,
): boolean {
  if (
    input.type !== "keyDown" ||
    input.key.toLocaleLowerCase() !== "w" ||
    !input.meta ||
    input.alt ||
    input.control ||
    input.shift ||
    !validatedOrigin
  ) {
    return false;
  }

  try {
    const current = new URL(currentUrl);
    return (
      current.origin === new URL(validatedOrigin).origin &&
      current.pathname === "/" &&
      Boolean(current.searchParams.get("path")?.trim())
    );
  } catch {
    return false;
  }
}
