import fs from "node:fs";
import path from "node:path";

export interface NativeOpenDocumentIntent {
  path: string;
  modifiedAt: number;
}

type NativeOpenPathConsumer = (filePath: string) => void;

export function resolveMarkdownOpenIntent(
  candidatePath: string,
): NativeOpenDocumentIntent {
  const targetPath = path.resolve(candidatePath);

  try {
    const stats = fs.statSync(targetPath);
    if (path.extname(targetPath).toLowerCase() !== ".md" || !stats.isFile()) {
      throw new Error("unsupported file");
    }

    return { path: targetPath, modifiedAt: stats.mtimeMs };
  } catch {
    throw new Error(
      `Roughdraft can only open existing .md files: ${targetPath}`,
    );
  }
}

export async function postOpenDocumentIntent(
  fetchImpl: typeof fetch,
  validatedOrigin: string,
  intent: NativeOpenDocumentIntent,
): Promise<{ delivered: boolean }> {
  const response = await fetchImpl(
    new URL("/api/open-request", validatedOrigin),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intent),
      signal: AbortSignal.timeout(2_000),
    },
  );

  if (!response.ok) {
    throw new Error(`The Roughdraft server returned HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    accepted?: unknown;
    delivered?: unknown;
  };
  if (payload.accepted !== true) {
    throw new Error("The Roughdraft server did not accept the open request.");
  }

  return { delivered: payload.delivered === true };
}

export class NativeOpenPathQueue {
  private consumer: NativeOpenPathConsumer | null = null;
  private pendingPath: string | null = null;

  request(filePath: string): void {
    if (this.consumer) {
      this.consumer(filePath);
      return;
    }

    this.pendingPath = filePath;
  }

  connect(consumer: NativeOpenPathConsumer): void {
    this.consumer = consumer;
    if (!this.pendingPath) return;

    const pendingPath = this.pendingPath;
    this.pendingPath = null;
    consumer(pendingPath);
  }

  disconnect(): void {
    this.consumer = null;
  }
}
