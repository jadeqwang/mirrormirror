import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadServerConfig, loadWriterPrompt } from "./config.ts";
import { ORDERED_GENERATION_SCHEMA, parseGateBeforeBeats } from "./generate.ts";

/**
 * Answers the question the whole build has been deferring: does the configured
 * provider actually behave the way the safety design assumes?
 *
 * Three assumptions, in descending order of how badly they hurt:
 *
 * 1. **Property order.** `parseGateBeforeBeats` refuses output whose top-level
 *    keys are not `people, group_size, skip, skip_reason, beats`, because the
 *    gate has to be decided before the beats are readable. Cloudflare's docs say
 *    Workers AI "can't guarantee that the model responds according to the
 *    requested JSON Schema" and say nothing about ordering. If order drifts on
 *    every call, every performance silently falls back to a canned conversation
 *    and the piece quietly stops being itself. This is why the run count
 *    defaults to 5: one success proves nothing about consistency.
 * 2. **Vision.** The piece is one call that sees the visitor. A provider that
 *    ignores or rejects the image is not usable at any price.
 * 3. **Latency.** The pre-roll buys roughly three seconds (spec §7) and the
 *    server gives up at `GENERATION_TIMEOUT_MS`. Slower than that reads as
 *    broken rather than as thinking.
 *
 * Usage:
 *   npm run verify:provider -- path/to/photo.jpg   # full check, including vision
 *   npm run verify:provider -- --no-image          # ordering/auth only, no photo needed
 *   npm run verify:provider -- photo.jpg --runs=10 --no-strict
 */

const EXPECTED_ORDER = ["people", "group_size", "skip", "skip_reason", "beats"];

const DESCRIBED_SCENE =
  "There is no photograph attached to this request. For this test only, treat the frame as: " +
  "one adult standing in the zone, wearing a bright green corduroy jacket over a plain white shirt " +
  "and dark jeans. Produce your normal output for that visitor.";

interface Attempt {
  ok: boolean;
  ms: number;
  order?: string[];
  orderOk?: boolean;
  skip?: boolean;
  beats?: number;
  error?: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runs = Number(args.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 5);
  const strict = !args.includes("--no-strict");
  const noImage = args.includes("--no-image");
  const imagePath = args.find((a) => !a.startsWith("--"));

  if (!noImage && !imagePath) {
    console.error(
      "Pass a JPEG/PNG to test vision, or --no-image to check ordering and auth only.\n" +
      "  npm run verify:provider -- fixtures/eval/images/perform-green-jacket.jpg\n" +
      "  npm run verify:provider -- --no-image",
    );
    process.exitCode = 2;
    return;
  }

  const config = await loadServerConfig();
  const prompt = await loadWriterPrompt(config.promptPath);
  if (!config.apiKey) {
    console.error("No API credentials resolved. Set them for the configured provider and try again.");
    process.exitCode = 2;
    return;
  }

  let userContent: unknown;
  if (noImage) {
    userContent = DESCRIBED_SCENE;
  } else {
    const bytes = await readFile(imagePath!);
    const mime = imagePath!.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    userContent = [{ type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` } }];
  }

  console.log(`provider  ${config.provider}`);
  console.log(`model     ${config.model}`);
  console.log(`endpoint  ${config.apiUrl}`);
  console.log(`image     ${noImage ? "(none — ordering probe only)" : basename(imagePath!)}`);
  console.log(`runs      ${runs}${strict ? "" : "  (strict:false)"}\n`);

  const attempts: Attempt[] = [];
  for (let i = 0; i < runs; i += 1) {
    attempts.push(await attempt(config, prompt, userContent, strict));
    const last = attempts.at(-1)!;
    const verdict = !last.ok
      ? `FAILED  ${last.error}`
      : `${last.orderOk ? "order ok" : `ORDER WRONG  ${last.order?.join(", ")}`}` +
        `  ·  ${last.skip ? "skip" : `${last.beats} beats`}`;
    console.log(`run ${String(i + 1).padStart(2)}  ${String(last.ms).padStart(6)}ms  ${verdict}`);
  }

  report(attempts, config.generationTimeoutMs);
}

async function attempt(
  config: Awaited<ReturnType<typeof loadServerConfig>>,
  prompt: string,
  userContent: unknown,
  strict: boolean,
): Promise<Attempt> {
  const started = Date.now();
  try {
    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "mirror_mirror_generation", strict, schema: ORDERED_GENERATION_SCHEMA },
        },
        ...(config.thinking ? {} : { chat_template_kwargs: { thinking: false } }),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const ms = Date.now() - started;
    if (!response.ok) {
      return { ok: false, ms, error: `HTTP ${response.status}: ${(await response.text().catch(() => "")).slice(0, 300)}` };
    }
    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { ok: false, ms, error: "no string content in choices[0].message" };

    const order = topLevelKeys(content);
    const orderOk = order.length === EXPECTED_ORDER.length && order.every((key, i) => key === EXPECTED_ORDER[i]);

    // The real parser, not a copy of it: this is what runs in production.
    try {
      const gated = parseGateBeforeBeats(content);
      return { ok: true, ms, order, orderOk, skip: gated.skip, beats: gated.skip ? 0 : gated.beats.length };
    } catch (error) {
      return { ok: false, ms, order, orderOk, error: `gate parser rejected it: ${message(error)}` };
    }
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: message(error) };
  }
}

/** Key order as it appears in the raw text, which is the thing under test. */
function topLevelKeys(raw: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      if (depth === 1) {
        const end = raw.indexOf('"', i + 1);
        const after = raw.slice(end + 1).match(/^\s*:/);
        if (end > 0 && after) keys.push(raw.slice(i + 1, end));
      }
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
  }
  return keys;
}

function report(attempts: Attempt[], timeoutMs: number): void {
  const ok = attempts.filter((a) => a.ok);
  const ordered = attempts.filter((a) => a.orderOk);
  const times = attempts.map((a) => a.ms).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  const worst = times.at(-1) ?? 0;

  console.log(`\n${ok.length}/${attempts.length} usable · ${ordered.length}/${attempts.length} in gate order`);
  console.log(`latency median ${median}ms, worst ${worst}ms (server gives up at ${timeoutMs}ms)`);

  const problems: string[] = [];
  const alphabetical = attempts.some((a) => a.order && a.order.length > 1
    && a.order.join() === [...a.order].sort().join()
    && a.order.join() !== EXPECTED_ORDER.join());
  if (alphabetical) {
    problems.push(
      "The provider is returning keys in ALPHABETICAL order, not schema order. That is not\n" +
      "  intermittent and no amount of prompting fixes it — `beats` sorts before `skip`, so the\n" +
      "  gate can never precede the beats here. This needs a decision, not a retry: see\n" +
      "  IMPLEMENTATION_PLAN.md §5.1.",
    );
  } else if (ordered.length !== attempts.length) {
    problems.push(
      "Property order is not stable. The gate parser rejects out-of-order output and the server\n" +
      "  substitutes a canned conversation, so this fails safe — but if it happens often the piece\n" +
      "  silently becomes forty canned conversations. Decide between: a provider that honours order,\n" +
      "  relaxing the parser to find `skip` wherever it appears (keeps the never-read-beats guarantee,\n" +
      "  loses the model-committed-before-writing one), or going back to two calls as in spec v0.1.",
    );
  }
  if (ok.length !== attempts.length) {
    problems.push(`Some calls failed outright: ${[...new Set(attempts.filter((a) => !a.ok).map((a) => a.error))].join(" | ")}`);
  }
  if (worst > timeoutMs) {
    problems.push(
      `Worst case ${worst}ms exceeds the ${timeoutMs}ms budget. The pre-roll only buys about three\n` +
      "  seconds; past that the visitor sees a canned conversation instead of one about them.",
    );
  }

  if (problems.length === 0) {
    console.log("\nAll three assumptions hold on this sample. Re-run before the install and after any model change.");
    return;
  }
  console.log("");
  for (const problem of problems) console.log(`- ${problem}`);
  process.exitCode = 1;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

await main();
