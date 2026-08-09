import { loadMockGeneration, requestedMockGenerationCase } from "../dev-harness/mock-generation.mjs";
import type { GenerateStructured } from "./generate.ts";

/** MOCK_GENERATION fixtures enter at the model boundary, never at the HTTP boundary. */
export function createMockGenerator(request: { url?: string; headers?: Record<string, string | string[] | undefined> }): GenerateStructured {
  return async () => {
    const fixture = await loadMockGeneration(requestedMockGenerationCase(request));
    if (isModelFixture(fixture)) return orderedModelJson(fixture);
    if (isKioskFixture(fixture)) return orderedModelJson({
      people: fixture.people, group_size: fixture.group_size, skip: false, skip_reason: null, beats: fixture.beats,
    });
    return JSON.stringify(fixture);
  };
}

function isModelFixture(value: any): boolean { return value && typeof value === "object" && typeof value.skip === "boolean"; }
function isKioskFixture(value: any): boolean { return value && typeof value === "object" && Array.isArray(value.beats); }
function orderedModelJson(value: any): string {
  return JSON.stringify({ people: value.people, group_size: value.group_size, skip: value.skip, skip_reason: value.skip_reason, beats: value.beats });
}
