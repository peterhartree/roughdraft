import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import "./style.css";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function applyColorScheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

applyColorScheme(darkQuery.matches);
darkQuery.addEventListener("change", (event) => {
  applyColorScheme(event.matches);
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}
const root = rootElement;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// A local document loaded in a plain browser belongs in Roughdraft.app: ask
// the server to open it there. The server declines when it is not app-only
// (browser tests) or the app cannot launch, and the page renders as usual.
async function handOffToDesktopApp(): Promise<boolean> {
  const documentPath = new URLSearchParams(window.location.search).get("path");
  if (
    window.roughdraftDesktop ||
    !documentPath ||
    !LOOPBACK_HOSTS.has(window.location.hostname)
  ) {
    return false;
  }
  try {
    const response = await fetch("/api/open-in-app", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: documentPath }),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { handedOff?: unknown };
    return payload.handedOff === true;
  } catch {
    return false;
  }
}

function renderHandOffNotice() {
  const notice = document.createElement("p");
  notice.className =
    "mx-auto mt-24 max-w-md px-4 text-center text-sm text-muted-foreground";
  notice.textContent = "Opened in Roughdraft. You can close this tab.";
  root.replaceChildren(notice);
  window.close();
}

void handOffToDesktopApp().then((handedOff) => {
  if (handedOff) {
    renderHandOffNotice();
    return;
  }
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </StrictMode>,
  );
});
