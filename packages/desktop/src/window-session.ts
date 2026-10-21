import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAX_WINDOWS = 20;
const MAX_WINDOW_ID_LENGTH = 128;
const MAX_COORDINATE_MAGNITUDE = 1_000_000;
const MIN_WINDOW_DIMENSION = 100;
const MAX_WINDOW_DIMENSION = 100_000;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedWindow {
  id: string;
  bounds?: WindowBounds;
  maximized?: boolean;
}

export interface WindowSession {
  windows: SavedWindow[];
  focusedId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isWindowId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_WINDOW_ID_LENGTH &&
    value === value.trim()
  );
}

function isCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    Math.abs(value) <= MAX_COORDINATE_MAGNITUDE
  );
}

function isDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_WINDOW_DIMENSION &&
    value <= MAX_WINDOW_DIMENSION
  );
}

function parseBounds(value: unknown): WindowBounds | null {
  if (
    !isRecord(value) ||
    !isCoordinate(value.x) ||
    !isCoordinate(value.y) ||
    !isDimension(value.width) ||
    !isDimension(value.height)
  ) {
    return null;
  }

  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  };
}

export function parseWindowSession(value: unknown): WindowSession | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.windows) ||
    value.windows.length === 0 ||
    value.windows.length > MAX_WINDOWS
  ) {
    return null;
  }

  const ids = new Set<string>();
  const windows: SavedWindow[] = [];
  for (const candidate of value.windows) {
    if (!isRecord(candidate) || !isWindowId(candidate.id)) return null;
    if (ids.has(candidate.id)) return null;

    const savedWindow: SavedWindow = { id: candidate.id };
    if (candidate.bounds !== undefined) {
      const bounds = parseBounds(candidate.bounds);
      if (!bounds) return null;
      savedWindow.bounds = bounds;
    }
    if (candidate.maximized !== undefined) {
      if (typeof candidate.maximized !== "boolean") return null;
      savedWindow.maximized = candidate.maximized;
    }

    ids.add(candidate.id);
    windows.push(savedWindow);
  }

  if (value.focusedId !== undefined) {
    if (!isWindowId(value.focusedId) || !ids.has(value.focusedId)) return null;
    return { windows, focusedId: value.focusedId };
  }

  return { windows };
}

export function readWindowSession(filePath: string): WindowSession | null {
  try {
    return parseWindowSession(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

export function writeWindowSession(
  filePath: string,
  session: WindowSession,
): void {
  const validated = parseWindowSession(session);
  if (!validated) throw new TypeError("Invalid window session");

  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  fs.mkdirSync(directory, { recursive: true });

  let temporaryFileExists = false;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(validated)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    temporaryFileExists = true;
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (temporaryFileExists) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Keep the original write error. A uniquely named temporary file is
        // harmless and can be replaced by a later successful session write.
      }
    }
    throw error;
  }
}
