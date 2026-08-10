import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { cloudflareChatCompletionsUrl } from "./model.ts";

export type ProviderName = "cloudflare" | "openai";

export interface ServerConfig {
  rootDir: string;
  host: string;
  port: number;
  provider: ProviderName;
  model: string;
  apiUrl: string;
  apiKey: string;
  maxTokens: number;
  staticDir: string;
  promptPath: string;
  denylistPath: string;
  offlinePoolPath: string;
  generationTimeoutMs: number;
}

/**
 * `kimi-k2.7-code` is the 2.7 variant Workers AI publishes, and it is tuned for
 * code and agentic work. This piece asks for comedy and fine social judgment,
 * so `@cf/moonshotai/kimi-k2.6` (general, vision, structured outputs) is worth
 * A/B-ing against it on the eval set before the show.
 */
const DEFAULT_MODEL: Record<ProviderName, string> = {
  cloudflare: "@cf/moonshotai/kimi-k2.7-code",
  openai: "gpt-4.1-mini",
};

export async function loadServerConfig(env: NodeJS.ProcessEnv = process.env): Promise<ServerConfig> {
  const root = resolve(env.MIRRORMIRROR_ROOT ?? process.cwd());
  const mocked = env.MOCK_GENERATION === "1";
  const provider = providerName(env.GENERATION_PROVIDER);
  const { apiKey, apiUrl } = provider === "cloudflare"
    ? resolveCloudflare(env, mocked)
    : resolveOpenAI(env, mocked);

  const config: ServerConfig = {
    rootDir: root,
    host: env.HOST?.trim() || "127.0.0.1",
    port: integer(env.PORT, 4173, 1, 65535),
    provider,
    model: env.GENERATION_MODEL?.trim() || DEFAULT_MODEL[provider],
    apiUrl,
    apiKey,
    maxTokens: integer(env.GENERATION_MAX_TOKENS, 1_200, 256, 32_000),
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

function providerName(value: string | undefined): ProviderName {
  const name = value?.trim().toLowerCase();
  if (!name || name === "cloudflare") return "cloudflare";
  if (name === "openai") return "openai";
  throw new Error(`unknown GENERATION_PROVIDER: ${value}`);
}

function resolveCloudflare(env: NodeJS.ProcessEnv, mocked: boolean): { apiKey: string; apiUrl: string } {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const apiKey = env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  if (!mocked && (!accountId || !apiKey)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required unless MOCK_GENERATION=1");
  }
  const apiUrl = env.GENERATION_API_URL?.trim()
    || cloudflareChatCompletionsUrl(accountId || "unset", env.CLOUDFLARE_API_BASE?.trim() || undefined);
  return { apiKey, apiUrl };
}

function resolveOpenAI(env: NodeJS.ProcessEnv, mocked: boolean): { apiKey: string; apiUrl: string } {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if (!mocked && !apiKey) throw new Error("OPENAI_API_KEY is required unless MOCK_GENERATION=1");
  const apiUrl = env.GENERATION_API_URL?.trim() || env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";
  return { apiKey, apiUrl };
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
