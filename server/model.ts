import type { GenerateStructured, ModelCall } from "./generate.ts";

export type ProviderName = "cloudflare" | "openai";

export interface ProviderOptions {
  provider: ProviderName;
  /** Fully-resolved chat-completions URL. Built in config.ts. */
  apiUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  maxTokens: number;
  /** Kimi reasons by default; see the request body for why this is off. */
  thinking: boolean;
}

/**
 * Both providers are addressed through an OpenAI-shaped chat-completions API.
 * Cloudflare Workers AI exposes one at
 * `/client/v4/accounts/{id}/ai/v1/chat/completions`, which is why switching
 * providers is a URL, a key, and a model string rather than a second client.
 *
 * Two things here are load-bearing and easy to break:
 *
 * 1. `response_format` carries the ordered schema from `generate.ts`. The gate
 *    fields must arrive before `beats`, because `parseGateBeforeBeats` refuses
 *    output whose top-level keys are out of order. Cloudflare's docs say plainly
 *    that Workers AI "can't guarantee that the model responds according to the
 *    requested JSON Schema", and say nothing at all about property order — so
 *    this assumption is checked empirically by `scripts/verify-provider.mjs`,
 *    not assumed. It fails safe either way: a violation throws and the server
 *    substitutes an offline conversation.
 *
 * 2. The writer prompt goes in a `system` message, not next to the image in the
 *    user turn. `content/README.md` documents it as a system prompt and the two
 *    had drifted apart.
 */
export function createProviderGenerator(options: ProviderOptions): GenerateStructured {
  return async (call: ModelCall): Promise<string> => {
    const image = `data:${call.mimeType};base64,${Buffer.from(call.frame).toString("base64")}`;
    const response = await fetch(options.apiUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens,
        messages: [
          { role: "system", content: options.prompt },
          { role: "user", content: [{ type: "image_url", image_url: { url: image } }] },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "mirror_mirror_generation", strict: true, schema: call.schema },
        },
        // Kimi reasons by default, and with thinking on it puts everything in
        // `reasoning_content` and returns `content: ""` — which the gate parser
        // correctly rejects as "not an object". It also costs 13–26s against a
        // 5.5s budget. Off, the same model answers in ~2–3.5s with a real JSON
        // object. Set CF_THINKING=on to measure it again.
        ...(options.thinking ? {} : { chat_template_kwargs: { thinking: false } }),
      }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) {
      // Body text is safe to surface: it is the provider's error, never the frame.
      const detail = await response.text().catch(() => "");
      throw new Error(`generation provider returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("generation provider returned no structured output");
    return content;
  };
}

/** `https://api.cloudflare.com/client/v4/accounts/{id}/ai/v1/chat/completions` */
export function cloudflareChatCompletionsUrl(accountId: string, base = "https://api.cloudflare.com/client/v4"): string {
  return `${base.replace(/\/+$/, "")}/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`;
}
