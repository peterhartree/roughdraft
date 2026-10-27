export interface UpdateStatus {
  packageName: string;
  currentVersion: string | null;
  latestVersion: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
  updateCommand: string;
}

export interface UpdateProgress {
  state: "idle" | "running" | "failed" | "done";
  step?: string | null;
  message?: string;
}

export async function fetchUpdateStatus(): Promise<UpdateStatus | null> {
  try {
    const response = await fetch("/api/update-status");
    if (!response.ok) return null;

    const payload = (await response.json()) as Partial<UpdateStatus>;
    if (!payload.updateAvailable) return null;
    if (
      typeof payload.packageName !== "string" ||
      typeof payload.currentVersion !== "string" ||
      typeof payload.latestVersion !== "string" ||
      typeof payload.updateCommand !== "string"
    ) {
      return null;
    }

    return {
      packageName: payload.packageName,
      currentVersion: payload.currentVersion,
      latestVersion: payload.latestVersion,
      releaseUrl:
        typeof payload.releaseUrl === "string" ? payload.releaseUrl : null,
      updateAvailable: true,
      updateCommand: payload.updateCommand,
    };
  } catch {
    return null;
  }
}

export async function startUpdate(): Promise<UpdateProgress> {
  try {
    const response = await fetch("/api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const payload = (await response.json()) as Partial<UpdateProgress> & {
      error?: string;
    };
    if (response.status === 409) return { state: "running" };
    if (!response.ok) {
      return {
        state: "failed",
        message: payload.error ?? payload.message ?? "The update didn't start.",
      };
    }
    return { state: "running", message: payload.message };
  } catch {
    return { state: "failed", message: "Couldn't reach Roughdraft's server." };
  }
}

export async function fetchUpdateProgress(): Promise<UpdateProgress | null> {
  try {
    const response = await fetch("/api/update-progress");
    if (!response.ok) return null;
    return (await response.json()) as UpdateProgress;
  } catch {
    // The update stops the server just before it reinstalls the app.
    return null;
  }
}
