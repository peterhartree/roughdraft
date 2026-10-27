import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPackageJsonPath = path.resolve(__dirname, "../../../package.json");
const DEFAULT_PACKAGE_NAME = "roughdraft";

interface PackageManifest {
  name?: string;
  version?: string;
}

interface ParsedVersion {
  parts: number[];
  prerelease: string[];
}

export interface UpdateStatus {
  packageName: string;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateCommand: string;
}

interface ResolveUpdateStatusOptions {
  fetchImpl?: typeof fetch;
  packageJsonPath?: string;
  packageName?: string;
  /**
   * Where to remember the last check. Agents run the CLI many times an hour,
   * so without this every command would ask the release source again.
   */
  cacheFile?: string;
  now?: () => number;
}

interface UpdateCheckCache {
  packageName: string;
  checkedAt: number;
  latestVersion: string | null;
}

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
// An unreachable source is retried sooner, but not on every command.
const FAILED_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function defaultUpdateCheckCacheFile(homeDir: string): string {
  return path.join(homeDir, ".roughdraft", "update-check.json");
}

function readCachedLatestVersion(
  cacheFile: string,
  packageName: string,
  now: number,
): { latestVersion: string | null } | null {
  try {
    const cache = JSON.parse(
      fs.readFileSync(cacheFile, "utf8"),
    ) as Partial<UpdateCheckCache>;
    if (cache.packageName !== packageName) return null;
    if (typeof cache.checkedAt !== "number") return null;
    const latestVersion =
      typeof cache.latestVersion === "string" ? cache.latestVersion : null;
    const interval = latestVersion
      ? CHECK_INTERVAL_MS
      : FAILED_CHECK_INTERVAL_MS;
    if (now - cache.checkedAt < 0 || now - cache.checkedAt >= interval) {
      return null;
    }
    return { latestVersion };
  } catch {
    return null;
  }
}

function writeCachedLatestVersion(
  cacheFile: string,
  cache: UpdateCheckCache,
): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, `${JSON.stringify(cache)}\n`);
  } catch {}
}

function readInstalledPackageInfo(packageJsonPath = defaultPackageJsonPath): {
  packageName: string;
  currentVersion: string | null;
} {
  try {
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const manifest = JSON.parse(raw) as PackageManifest;
    return {
      packageName: manifest.name?.trim() || DEFAULT_PACKAGE_NAME,
      currentVersion: manifest.version?.trim() || null,
    };
  } catch {
    return {
      packageName: DEFAULT_PACKAGE_NAME,
      currentVersion: null,
    };
  }
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

async function fetchLatestVersion(
  packageName: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(1500),
      },
    );

    if (!response.ok) return null;

    const payload = (await response.json()) as PackageManifest;
    return payload.version?.trim() || null;
  } catch {
    return null;
  }
}

export async function resolveUpdateStatus(
  options: ResolveUpdateStatusOptions = {},
): Promise<UpdateStatus> {
  const installedPackageInfo = readInstalledPackageInfo(
    options.packageJsonPath,
  );
  const packageName =
    options.packageName?.trim() || installedPackageInfo.packageName;
  const currentVersion = installedPackageInfo.currentVersion;
  const now = (options.now ?? Date.now)();
  const cached = options.cacheFile
    ? readCachedLatestVersion(options.cacheFile, packageName, now)
    : null;
  let latestVersion: string | null;
  if (cached) {
    latestVersion = cached.latestVersion;
  } else {
    latestVersion = await fetchLatestVersion(
      packageName,
      options.fetchImpl ?? fetch,
    );
    if (options.cacheFile) {
      writeCachedLatestVersion(options.cacheFile, {
        packageName,
        checkedAt: now,
        latestVersion,
      });
    }
  }

  return {
    packageName,
    currentVersion,
    latestVersion,
    updateAvailable:
      !!currentVersion &&
      !!latestVersion &&
      compareVersions(currentVersion, latestVersion) < 0,
    updateCommand: `npm i -g ${packageName}@latest`,
  };
}
