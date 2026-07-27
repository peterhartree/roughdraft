import { isAllowedNavigation } from "./server-target.js";

export function shouldAllowRendererPermission({
  permission,
  requestingOrigin,
  validatedOrigin,
  isMainFrame,
}: {
  permission: string;
  requestingOrigin: string;
  validatedOrigin: string | null;
  isMainFrame: boolean;
}): boolean {
  if (
    permission !== "clipboard-sanitized-write" ||
    !validatedOrigin ||
    !isMainFrame
  ) {
    return false;
  }

  return isAllowedNavigation(requestingOrigin, validatedOrigin);
}
