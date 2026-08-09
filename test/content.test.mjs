import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = async (path) => JSON.parse(await readFile(new URL(path, `file://${root}`), "utf8"));

const denyRaw = await load("content/denylist.json");
const poolRaw = await load("content/offline-pool.json");
const prerollRaw = await load("content/preroll-pool.json");

/** Mirrors compileDenylist() in server/generate.ts. If that changes, this must too. */
const denylist = (Array.isArray(denyRaw) ? denyRaw : denyRaw.patterns).map((entry, index) => {
  if (typeof entry === "string") return { note: `#${index}`, re: new RegExp(entry, "iu") };
  assert.equal(typeof entry?.pattern, "string", `deny-list entry ${index} has no pattern`);
  const flags = typeof entry.flags === "string" ? entry.flags : "iu";
  return { note: entry.note ?? `#${index}`, re: new RegExp(entry.pattern, flags.includes("u") ? flags : `${flags}u`) };
});

const hits = (text) =>
  denylist.filter((entry) => {
    entry.re.lastIndex = 0;
    return entry.re.test(text);
  });

const conversations = Array.isArray(poolRaw) ? poolRaw : poolRaw.conversations;
const prerollLines = Array.isArray(prerollRaw) ? prerollRaw : prerollRaw.lines;
const wordCount = (text) => text.trim().split(/\s+/u).length;

test("deny-list compiles under the u flag the server uses", () => {
  assert.ok(denylist.length > 0);
});

test("deny-list catches what it exists to catch", () => {
  const mustCatch = [
    "That wheelchair is the most confident thing in the room right now.",
    "She looks like she made an effort today, and it shows.",
    "Those shoes look cheap and everyone standing here can tell.",
    "The hijab is a bold choice and I respect it enormously.",
    "Scrubs at a gallery is commitment, and I am quietly impressed.",
    "You are the tallest thing in this room by a clear margin.",
    "Nobody dresses like that unless they are hiding a body somewhere.",
    "Are those pregnancy jeans, or is that simply the cut?",
    "A grown man in that jacket is a decision somebody made.",
    "That is a lot of look for a child on a Tuesday.",
    "You look older than the person who picked that jacket out.",
    "Nice lanyard. Somebody came straight here from the office, clearly.",
    "I like the crutches. Very committed to the whole aesthetic today.",
  ];
  for (const text of mustCatch) {
    assert.ok(hits(text).length > 0, `deny-list missed: ${text}`);
  }
});

test("deny-list does not fire on ordinary beat text", () => {
  // A deny-list that converts most performances into canned fallbacks has broken
  // the piece as thoroughly as one that misses. These must all pass through.
  const mustPass = [
    "Every item you are wearing is black and I still cannot tell.",
    "That green jacket is fearless and I will not hear otherwise.",
    "The one in the denim jacket has clearly made a decision today.",
    "You look tired.",
    "They do not look tired.",
  ];
  for (const text of mustPass) {
    const matched = hits(text);
    assert.equal(matched.length, 0, `false positive on "${text}": ${matched.map((m) => m.note).join("; ")}`);
  }
});

test("offline pool loads in the shape both loaders expect", () => {
  assert.ok(Array.isArray(conversations) && conversations.length > 0);
  assert.ok(conversations.length >= 40, `spec §8 asks for ~40 conversations, found ${conversations.length}`);
  const ids = conversations.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate conversation ids");
});

test("every offline conversation obeys the beat rules", () => {
  for (const convo of conversations) {
    const beats = Array.isArray(convo) ? convo : convo.beats;
    const id = convo.id ?? "(unnamed)";
    assert.equal(beats?.length, 4, `${id}: must have exactly four beats`);
    beats.forEach((beat, i) => {
      assert.ok(beat.screen === "praise" || beat.screen === "roast", `${id} beat ${i + 1}: bad screen`);
      assert.notEqual(beat.text.trim(), "", `${id} beat ${i + 1}: empty`);
      const words = wordCount(beat.text);
      assert.ok(words >= 8 && words <= 15, `${id} beat ${i + 1}: ${words} words, spec §4 says 8-15`);
      assert.equal(hits(beat.text).length, 0, `${id} beat ${i + 1}: deny-list hit on fallback text`);
      if (i > 0) assert.notEqual(beats[i - 1].screen, beat.screen, `${id} beat ${i + 1}: breaks strict alternation`);
    });
  }
});

test("offline pool references no wardrobe, appearance, or group size", () => {
  // Spec §8: the fallbacks fire precisely when that information is missing or
  // forbidden, so a fallback that mentions a jacket is a fallback that lies.
  const forbidden =
    /\b(?:jackets?|shirts?|t-shirts?|coats?|dress(?:es)?|trousers?|jeans?|shoes?|boots?|scarf|scarves|hats?|caps?|jumpers?|sweaters?|hoodies?|suits?|ties?|glasses|colou?rs?|wearing|wears?|outfits?|black|white|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|beige)\b/iu;
  for (const convo of conversations) {
    for (const [i, beat] of (convo.beats ?? convo).entries()) {
      assert.ok(!forbidden.test(beat.text), `${convo.id} beat ${i + 1}: references wardrobe or colour — "${beat.text}"`);
    }
  }
});

test("offline pool keeps the roast-last button in the majority", () => {
  const roastLast = conversations.filter((c) => (c.beats ?? c)[3].screen === "roast").length;
  const ratio = roastLast / conversations.length;
  // Spec §4 targets ~70% roast-last, with praise-last kept in the mix.
  assert.ok(ratio >= 0.6 && ratio <= 0.85, `roast-last ratio ${(ratio * 100).toFixed(0)}%, want ~70%`);
  assert.ok(roastLast < conversations.length, "praise-last must stay in the mix");
});

test("pre-roll lines are two words and say nothing about anyone", () => {
  assert.ok(Array.isArray(prerollLines) && prerollLines.length > 0);
  assert.equal(new Set(prerollLines).size, prerollLines.length, "duplicate pre-roll lines");
  for (const line of prerollLines) {
    assert.equal(wordCount(line), 2, `pre-roll "${line}": spec §7 says a two-word acknowledgment`);
    assert.equal(hits(line).length, 0, `pre-roll "${line}": deny-list hit`);
  }
});

test("the writer prompt still carries its load-bearing instructions", () => {
  // Guards against a prompt edit that silently drops a requirement. Spec §1 and §4
  // both single out the disagreement device as the hedge for the whole piece.
  return readFile(new URL("content/writer-prompt.md", `file://${root}`), "utf8").then((prompt) => {
    for (const required of [
      "disagreement device",
      "contradicting each other about what they can see",
      "praise side needs this filter exactly as much as the roast side",
      "8 to 15 words per beat",
      "setup → counter → escalation → button",
      "alluding",
      "at most three",
    ]) {
      assert.ok(prompt.includes(required), `writer prompt no longer contains: "${required}"`);
    }
  });
});
