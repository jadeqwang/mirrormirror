import type { GenerateStructured, ModelCall } from "./generate.ts";

interface ProviderOptions { apiKey: string; apiUrl: string; model: string; prompt: string }

export function createProviderGenerator(options: ProviderOptions): GenerateStructured {
  return async (call: ModelCall): Promise<string> => {
    const response = await fetch(options.apiUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: "user", content: [
          { type: "text", text: options.prompt },
          { type: "image_url", image_url: { url: `data:${call.mimeType};base64,${Buffer.from(call.frame).toString("base64")}` } },
        ] }],
        response_format: { type: "json_schema", json_schema: { name: "mirror_mirror_generation", strict: true, schema: call.schema } },
      }),
      signal: AbortSignal.timeout(5_400),
    });
    if (!response.ok) throw new Error(`generation provider returned HTTP ${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("generation provider returned no structured output");
    return content;
  };
}
