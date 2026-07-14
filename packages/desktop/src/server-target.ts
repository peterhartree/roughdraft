import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ManagedServerTarget {
  port: number;
  url: string;
}

interface ResolveStateFileOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function resolveManagedServerStateFile({
  env = process.env,
  homeDir = os.homedir(),
}: ResolveStateFileOptions = {}): string {
  const explicitFile = env.ROUGHDRAFT_STATE_FILE?.trim();
  if (explicitFile) return path.resolve(explicitFile);

  const explicitDirectory = env.ROUGHDRAFT_STATE_DIR?.trim();
  if (explicitDirectory) {
    return path.resolve(explicitDirectory, "server.json");
  }

  return path.join(homeDir, ".roughdraft", "server.json");
}

export function validateManagedServerTarget(
  input: unknown,
): ManagedServerTarget {
  if (!input || typeof input !== "object") {
    throw new Error("The Roughdraft server state is not an object.");
  }

  const state = input as { port?: unknown; url?: unknown };
  if (
    typeof state.port !== "number" ||
    !Number.isInteger(state.port) ||
    state.port < 1 ||
    state.port > 65_535
  ) {
    throw new Error("The Roughdraft server state has an invalid port.");
  }
  if (typeof state.url !== "string" || state.url.trim().length === 0) {
    throw new Error("The Roughdraft server state has no URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(state.url);
  } catch {
    throw new Error("The Roughdraft server state has an invalid URL.");
  }

  if (
    parsed.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      "Roughdraft Desktop only loads an unauthenticated loopback HTTP server.",
    );
  }

  const parsedPort = Number(parsed.port || 80);
  if (parsedPort !== state.port) {
    throw new Error(
      "The Roughdraft server URL port does not match the managed state.",
    );
  }

  return { port: state.port, url: parsed.origin };
}

export function readManagedServerTarget(
  stateFile: string,
): ManagedServerTarget {
  let state: unknown;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read Roughdraft server state: ${detail}`);
  }
  return validateManagedServerTarget(state);
}

export async function verifyManagedServerTarget(
  target: ManagedServerTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<ManagedServerTarget> {
  let response: Response;
  try {
    response = await fetchImpl(new URL("/api/status", target.url), {
      signal: AbortSignal.timeout(1_500),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach the managed Roughdraft server: ${detail}`);
  }

  if (!response.ok) {
    throw new Error(
      `The managed Roughdraft server returned HTTP ${response.status}.`,
    );
  }

  const payload = (await response.json()) as {
    backend?: unknown;
    port?: unknown;
  };
  if (payload.backend !== "local-files") {
    throw new Error("The managed server is not a Roughdraft backend.");
  }
  if (payload.port !== target.port) {
    throw new Error("The managed Roughdraft server reported a different port.");
  }

  return target;
}

export function isAllowedNavigation(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
