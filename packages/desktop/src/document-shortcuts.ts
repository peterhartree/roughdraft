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

export function shouldSuppressNativeDocumentShortcut(
  input: DocumentShortcutInput,
  currentUrl: string,
  validatedOrigin: string | null,
): boolean {
  const key = input.key.toLocaleLowerCase();
  const isRoutedShortcut =
    (key === "w" && !input.shift) ||
    (key === "f" && !input.shift) ||
    key === "g";
  if (
    input.type !== "keyDown" ||
    !isRoutedShortcut ||
    !input.meta ||
    input.alt ||
    input.control ||
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
