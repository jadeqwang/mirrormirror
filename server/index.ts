import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { createGenerationHandler, loadDenylist, loadOfflinePool } from "./generate.ts";
import { loadServerConfig, loadWriterPrompt } from "./config.ts";
import { createProviderGenerator } from "./model.ts";
import { createMockGenerator } from "./mock-model.ts";
import { serveStatic } from "./static.ts";

const startedAt = Date.now();
const config = await loadServerConfig();
const [prompt, denylist, offlinePool] = await Promise.all([loadWriterPrompt(config.promptPath), loadDenylist(config.denylistPath), loadOfflinePool(config.offlinePoolPath)]);
const provider = createProviderGenerator({
  provider: config.provider,
  apiKey: config.apiKey,
  apiUrl: config.apiUrl,
  model: config.model,
  prompt,
  // Keep the provider's own abort inside the handler's deadline so a slow
  // generation surfaces as a timeout rather than a hung socket.
  timeoutMs: Math.max(500, config.generationTimeoutMs - 100),
  maxTokens: config.maxTokens,
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true, provider: config.provider, model: config.model, uptime_s: Math.floor((Date.now() - startedAt) / 1000) }); return;
    }
    if (url.pathname === "/generate") {
      const handler = createGenerationHandler({
        generateStructured: process.env.MOCK_GENERATION === "1" ? createMockGenerator(request) : provider,
        offlinePool, denylist, timeoutMs: config.generationTimeoutMs,
        logSkip: (reason) => console.info("generation skipped", { reason }),
      });
      const result = await handler(await toWebRequest(request, url));
      await sendWebResponse(response, result); return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") { json(response, 405, { error: "method_not_allowed" }); return; }
    if (url.pathname === "/config.json") {
      await serveStatic(config.rootDir, "config.json", response, "config.example.json"); return;
    }
    if (url.pathname === "/config.example.json") {
      await serveStatic(config.rootDir, "config.example.json", response); return;
    }
    if (url.pathname === "/content" || url.pathname.startsWith("/content/")) {
      const contentPath = url.pathname.slice("/content".length) || "/";
      await serveStatic(`${config.rootDir}/content`, contentPath, response); return;
    }
    await serveStatic(config.staticDir, url.pathname, response);
  } catch (error) {
    console.error("request failed", error instanceof Error ? error.message : "unknown error");
    if (!response.headersSent) json(response, 500, { error: "internal_error" }); else response.end();
  }
});
server.listen(config.port, config.host, () => console.info(`Mirror Mirror listening on http://${config.host}:${config.port}`));

async function toWebRequest(request: IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  return new Request(url, { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : Readable.toWeb(request) as ReadableStream, duplex: "half" } as RequestInit);
}
async function sendWebResponse(response: ServerResponse, result: Response): Promise<void> {
  response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(value));
}
