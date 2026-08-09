import { readFile } from "node:fs/promises";

const FIXTURE_DIR = new URL("../fixtures/envelopes/", import.meta.url);
const CASES = new Set(["normal", "skip", "malformed", "slow"]);

export function mockGenerationEnabled(env = process.env) {
  return env.MOCK_GENERATION === "1";
}

export function requestedMockGenerationCase(request, env = process.env) {
  const requestUrl = new URL(request.url ?? "/generate", "http://localhost");
  const value = request.headers?.["x-mock-generation"] ??
    requestUrl.searchParams.get("mock_generation") ?? env.MOCK_GENERATION_CASE ?? "normal";
  return CASES.has(value) ? value : "normal";
}

/** Return a fixture body suitable for a mock /generate response. */
export async function loadMockGeneration(name = "normal") {
  if (!CASES.has(name)) throw new Error(`Unknown mock generation case: ${name}`);
  const fixture = JSON.parse(await readFile(new URL(`${name}.json`, FIXTURE_DIR), "utf8"));
  if (fixture.delay_ms) await new Promise((resolve) => setTimeout(resolve, fixture.delay_ms));
  return fixture.response ?? fixture;
}

export async function handleMockGeneration(request, response, env = process.env) {
  const name = requestedMockGenerationCase(request, env);
  const body = await loadMockGeneration(name);
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
