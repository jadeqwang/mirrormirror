import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

export interface ServerConfig {
  rootDir: string;
  host: string;
  port: number;
  model: string;
  apiUrl: string;
  apiKey: string;
  staticDir: string;
  promptPath: string;
  denylistPath: string;
  offlinePoolPath: string;
  generationTimeoutMs: number;
}

export async function loadServerConfig(env: NodeJS.ProcessEnv = process.env): Promise<ServerConfig> {
  const root = resolve(env.MIRRORMIRROR_ROOT ?? process.cwd());
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey && env.MOCK_GENERATION !== "1") {
    throw new Error("OPENAI_API_KEY is required unless MOCK_GENERATION=1");
  }
  const config: ServerConfig = {
    rootDir: root,
    host: env.HOST?.trim() || "127.0.0.1",
    port: integer(env.PORT, 4173, 1, 65535),
    model: env.GENERATION_MODEL?.trim() || "gpt-4.1-mini",
    apiUrl: env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions",
    apiKey,
    staticDir: resolve(root, env.STATIC_DIR?.trim() || "kiosk/dist"),
    promptPath: resolve(root, env.WRITER_PROMPT_PATH?.trim() || "content/writer-prompt.md"),
    denylistPath: resolve(root, env.DENYLIST_PATH?.trim() || "content/denylist.json"),
    offlinePoolPath: resolve(root, env.OFFLINE_POOL_PATH?.trim() || "content/offline-pool.json"),
    generationTimeoutMs: integer(env.GENERATION_TIMEOUT_MS, 5_500, 100, 5_900),
  };
  await Promise.all([
    readable(config.staticDir, "static build directory"),
    readable(config.promptPath, "writer prompt"),
    readable(config.denylistPath, "deny-list"),
    readable(config.offlinePoolPath, "offline pool"),
  ]);
  return config;
}

export async function loadWriterPrompt(path: string): Promise<string> {
  const prompt = (await readFile(path, "utf8")).trim();
  if (!prompt) throw new Error("writer prompt is empty");
  return prompt;
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`invalid integer setting: ${value}`);
  }
  return parsed;
}

async function readable(path: string, label: string): Promise<void> {
  try { await access(path, constants.R_OK); }
  catch { throw new Error(`${label} is not readable: ${path}`); }
}
