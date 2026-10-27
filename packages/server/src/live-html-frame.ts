// The page that runs a ```html live fence. The editor loads it in an iframe
// sandboxed with only `allow-scripts`, which gives it an opaque origin, and
// posts the widget's HTML in once the page says it is ready. The policy lets
// the widget's own inline scripts and styles run but loads nothing from the
// network. The message types must match packages/app/src/live-html-code-block.ts.
export const LIVE_HTML_FRAME_PATH = "/api/live-html-frame";

export const LIVE_HTML_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

// Written after the widget, because document.write discards the bootstrap
// page's listeners. It reports the content height so the editor can size the
// frame, and keeps link clicks from navigating the frame away.
const reporterScript = `(() => {
  const report = () =>
    parent.postMessage(
      {
        type: "roughdraft-live-html:height",
        height: document.documentElement.scrollHeight,
      },
      "*",
    );
  new ResizeObserver(report).observe(document.documentElement);
  addEventListener("load", report);
  document.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) {
        event.preventDefault();
      }
    },
    true,
  );
})();`;

const bootstrapScript = `(() => {
  const reporter = ${JSON.stringify(`<script>${reporterScript}</script>`).replaceAll("</", "<\\/")};
  let rendered = false;
  addEventListener("message", (event) => {
    if (rendered || event.source !== parent) return;
    const data = event.data;
    if (data?.type !== "roughdraft-live-html:render" || typeof data.html !== "string") return;
    rendered = true;
    const html = /^\\s*<!doctype/i.test(data.html) ? data.html : "<!doctype html>" + data.html;
    document.open();
    document.write(html + reporter);
    document.close();
  });
  parent.postMessage({ type: "roughdraft-live-html:ready" }, "*");
})();`;

export const LIVE_HTML_FRAME_DOCUMENT = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><script>${bootstrapScript}</script></body>
</html>
`;
