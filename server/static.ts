import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const TYPES: Record<string, string> = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".map": "application/json", ".svg": "image/svg+xml", ".webm": "video/webm" };

export async function serveStatic(root: string, pathname: string, response: ServerResponse, fallbackPathname?: string): Promise<void> {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { send(response, 400, "Bad request"); return; }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) { send(response, 403, "Forbidden"); return; }
  try {
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, { "content-type": `${TYPES[extname(candidate)] ?? "application/octet-stream"}; charset=utf-8`, "cache-control": relative === "index.html" ? "no-cache" : "public, max-age=3600", "x-content-type-options": "nosniff" });
    createReadStream(candidate).pipe(response);
  } catch {
    if (fallbackPathname !== undefined) {
      await serveStatic(root, fallbackPathname, response);
      return;
    }
    send(response, 404, "Not found");
  }
}

function send(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end(body);
}
