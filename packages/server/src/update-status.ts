import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPackageJsonPath = path.resolve(__dirname, "../../../package.json");
const DEFAULT_PACKAGE_NAME = "roughdraft";
export const UPDATE_COMMAND = "roughdraft update";

interface PackageManifest {
  name?: string;
  version?: string;
  repository?: string | { url?: string };
}

interface ParsedVersion {
  parts: number[];
  prerelease: string[];
}

export interface UpdateStatus {
  packageName: string;
  currentVersion: string | null;
  latestVersion: string | null;
  /** The release notes for the latest version. */
  releaseUrl: string | null;
  updateAvailable: boolean;
  updateCommand: string;
}

interface ResolveUpdateStatusOptions {
  fetchImpl?: typeof fetch;
  packageJsonPath?: string;
  packageName?: string;
  /** `owner/name` on GitHub; defaults to the package's repository. */
  releaseRepository?: string;
  /**
   * Where to remember the last check. Agents run the CLI many times an hour,
   * and GitHub allows 60 unauthenticated requests an hour.
   */
  cacheFile?: string;
  now?: () => number;
}

interface LatestRelease {
  version: string;
  url: string;
}

interface UpdateCheckCache {
  repository: string;
  checkedAt: number;
  latest: LatestRelease | null;
}

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
// An unreachable source is retried sooner, but not on every command.
const FAILED_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function defaultUpdateCheckCacheFile(homeDir: string): string {
  return path.join(homeDir, ".roughdraft", "update-check.json");
}

function readInstalledPackageInfo(packageJsonPath = defaultPackageJsonPath): {
  packageName: string;
  currentVersion: string | null;
  repository: string | null;
} {
  try {
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const manifest = JSON.parse(raw) as PackageManifest;
    const repositoryUrl =
      typeof manifest.repository === "string"
        ? manifest.repository
        : manifest.repository?.url;
    return {
      packageName: manifest.name?.trim() || DEFAULT_PACKAGE_NAME,
      currentVersion: manifest.version?.trim() || null,
      repository: gitHubRepository(repositoryUrl ?? ""),
    };
  } catch {
    return {
      packageName: DEFAULT_PACKAGE_NAME,
      currentVersion: null,
      repository: null,
    };
  }
}

export function gitHubRepository(url: string): string | null {
  const match =
    /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  return match ? `${match[1]}/${match[2]}` : null;
}

function readCachedRelease(
  cacheFile: string,
  repository: string,
  now: number,
): { latest: LatestRelease | null } | null {
  try {
    const cache = JSON.parse(
      fs.readFileSync(cacheFile, "utf8"),
    ) as Partial<UpdateCheckCache>;
    if (cache.repository !== repository) return null;
    if (typeof cache.checkedAt !== "number") return null;
    const latest =
      typeof cache.latest?.version === "string" &&
      typeof cache.latest?.url === "string"
        ? { version: cache.latest.version, url: cache.latest.url }
        : null;
    const age = now - cache.checkedAt;
    const interval = latest ? CHECK_INTERVAL_MS : FAILED_CHECK_INTERVAL_MS;
    if (age < 0 || age >= interval) return null;
    return { latest };
  } catch {
    return null;
  }
}

function writeCachedRelease(cacheFile: string, cache: UpdateCheckCache): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, `${JSON.stringify(cache)}\n`);
  } catch {}
}

function parseVersion(version: string): ParsedVersion {
  const normalizedVersion = version.trim().replace(/^v/i, "");
  const [mainVersion, prereleaseVersion = ""] = normalizedVersion.split("-", 2);
  const parts = mainVersion
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isNaN(part) ? 0 : part));

  const prerelease = prereleaseVersion
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  return { parts, prerelease };
}

function comparePrerelease(left: string[], right: string[]) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumber = Number.parseInt(leftPart, 10);
    const rightNumber = Number.parseInt(rightPart, 10);
    const leftIsNumeric = /^[0-9]+$/.test(leftPart);
    const rightIsNumeric = /^[0-9]+$/.test(rightPart);

    if (leftIsNumeric && rightIsNumeric) {
      if (leftNumber !== rightNumber) {
        return leftNumber < rightNumber ? -1 : 1;
      }
      continue;
    }

    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    }

    return leftPart.localeCompare(rightPart);
  }

  return 0;
}

export function compareVersions(leftVersion: string, rightVersion: string) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  const length = Math.max(left.parts.length, right.parts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left.parts[index] ?? 0;
    const rightPart = right.parts[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

async function fetchLatestRelease(
  repository: string,
  fetchImpl: typeof fetch,
): Promise<LatestRelease | null> {
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/releases/latest`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "roughdraft-update-check",
        },
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
    };
    if (
      typeof payload.tag_name !== "string" ||
      typeof payload.html_url !== "string"
    ) {
      return null;
    }
    const version = payload.tag_name.trim().replace(/^v/i, "");
    return version ? { version, url: payload.html_url } : null;
  } catch {
    return null;
  }
}

export async function resolveUpdateStatus(
  options: ResolveUpdateStatusOptions = {},
): Promise<UpdateStatus> {
  const installed = readInstalledPackageInfo(options.packageJsonPath);
  const packageName = options.packageName?.trim() || installed.packageName;
  const currentVersion = installed.currentVersion;
  const repository = options.releaseRepository ?? installed.repository;

  let latest: LatestRelease | null = null;
  if (repository) {
    const now = (options.now ?? Date.now)();
    const cached = options.cacheFile
      ? readCachedRelease(options.cacheFile, repository, now)
      : null;
    if (cached) {
      latest = cached.latest;
    } else {
      latest = await fetchLatestRelease(repository, options.fetchImpl ?? fetch);
      if (options.cacheFile) {
        writeCachedRelease(options.cacheFile, {
          repository,
          checkedAt: now,
          latest,
        });
      }
    }
  }

  return {
    packageName,
    currentVersion,
    latestVersion: latest?.version ?? null,
    releaseUrl: latest?.url ?? null,
    updateAvailable:
      !!currentVersion &&
      !!latest &&
      compareVersions(currentVersion, latest.version) < 0,
    updateCommand: UPDATE_COMMAND,
  };
}
