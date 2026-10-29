export const WINDOW_SESSION_CHANNEL = "roughdraft:window-session";
export const CLAIM_DOCUMENT_CHANNEL = "roughdraft:claim-document";
export const REPORT_DOCUMENTS_CHANNEL = "roughdraft:report-documents";
export const RELEASE_DOCUMENT_CHANNEL = "roughdraft:release-document";
export const WINDOW_READY_CHANNEL = "roughdraft:window-ready";
export const OPEN_DOCUMENT_CHANNEL = "roughdraft:open-document";
export const PREPARE_CLOSE_CHANNEL = "roughdraft:prepare-close";
export const CANCEL_CLOSE_CHANNEL = "roughdraft:cancel-close";
export const PREPARE_CLOSE_RESULT_CHANNEL = "roughdraft:prepare-close-result";
export const LIST_OTHER_WINDOWS_CHANNEL = "roughdraft:list-other-windows";
export const MOVE_DOCUMENT_CHANNEL = "roughdraft:move-document";

/** Another window a document can move to, named after its active file. */
export interface DesktopWindowSummary {
  id: string;
  label: string;
}

export interface DesktopOpenIntent {
  path: string;
  modifiedAt: number | null;
  activate?: boolean;
}
