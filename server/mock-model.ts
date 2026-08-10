import { loadMockGeneration, requestedMockGenerationCase } from "../dev-harness/mock-generation.mjs";
import type { GenerateStructured } from "./generate.ts";

/** MOCK_GENERATION fixtures enter at the model boundary, never at the HTTP boundary. */
export function createMockGenerator(request: { url?: string; headers?: Record<string, string | string[] | undefined> }): GenerateStructured {
  return async () => {
    const fixture = await loadMockGeneration(requestedMockGenerationCase(request));
    if (isModelFixture(fixture)) return orderedModelJson(fixture);
    if (isKioskFixture(fixture)) return orderedModelJson({
      group_size: fixture.group_size, people: fixture.people, skip: false, skip_reason: null, speech: fixture.beats,
    });
    return JSON.stringify(fixture);
  };
}

function isModelFixture(value: any): boolean { return value && typeof value === "object" && typeof value.skip === "boolean"; }
function isKioskFixture(value: any): boolean { return value && typeof value === "object" && Array.isArray(value.beats); }
/** Key order here mirrors ORDERED_GENERATION_SCHEMA: gate fields, then `speech`. */
function orderedModelJson(value: any): string {
  return JSON.stringify({
    group_size: value.group_size,
    people: value.people,
    skip: value.skip,
    skip_reason: value.skip_reason,
    speech: value.speech ?? value.beats,
  });
}
