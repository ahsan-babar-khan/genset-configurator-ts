import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAvailability,
  applySelection,
  sanitizeSelections,
  validateStep,
  firstIncompleteStep,
  checkDataIntegrity,
} from "../src/rules.ts";
import { loadData, FULL_CONFIG, must, statusOf } from "./helpers.ts";

const data = loadData();

test("fuels not supported by the engine are disabled with a reason", () => {
  const availability = getAvailability(data, { engine: "nw-m250" });
  const lng = statusOf(availability, "fuel", "lng");
  assert.equal(lng.available, false);
  assert.match(lng.reason, /NW-M250/);
  assert.equal(statusOf(availability, "fuel", "mdo").available, true);
  assert.equal(statusOf(availability, "fuel", "methanol").available, true);
});

test("'requires' rule: methanol disables every control system except advanced", () => {
  const availability = getAvailability(data, { fuel: "methanol" });
  assert.equal(statusOf(availability, "control", "basic").available, false);
  assert.equal(statusOf(availability, "control", "advanced").available, true);
});

test("'excludes' rule: SCR is not available with LNG", () => {
  const availability = getAvailability(data, { fuel: "lng" });
  assert.equal(statusOf(availability, "aftertreatment", "scr").available, false);
  assert.equal(statusOf(availability, "aftertreatment", "none").available, true);
});

test("'excludes' rule: the smallest engine cannot use the heat exchanger", () => {
  const availability = getAvailability(data, { engine: "nw-m250" });
  assert.equal(statusOf(availability, "cooling", "heat-exchanger").available, false);
});

test("nothing is disabled when nothing is selected", () => {
  const availability = getAvailability(data, {});
  for (const items of Object.values(availability)) {
    for (const status of Object.values(items)) assert.equal(status.available, true);
  }
});

test("changing an earlier choice resets later choices it makes invalid", () => {
  const { selections, resets } = applySelection(data, FULL_CONFIG, "engine", "nw-m250");
  assert.equal(selections.engine, "nw-m250");
  assert.equal(selections.fuel, undefined); // LNG not supported by M250
  assert.equal(selections.cooling, undefined); // heat exchanger not allowed
  assert.equal(selections.warranty, "5y"); // unaffected choices are kept
  assert.deepEqual(resets.map((r) => r.group).sort(), ["cooling", "fuel"]);
});

test("a valid change resets nothing", () => {
  const { selections, resets } = applySelection(data, FULL_CONFIG, "warranty", "2y");
  assert.equal(selections.warranty, "2y");
  assert.equal(resets.length, 0);
});

test("unknown ids (e.g. from an edited URL) are removed", () => {
  const { selections, resets } = sanitizeSelections(data, { engine: "nope", fuel: "mdo" });
  assert.deepEqual(selections, { fuel: "mdo" });
  assert.equal(must(resets[0], "first reset").group, "engine");
});

test("a rule added only to the data works without code changes", () => {
  const custom = structuredClone(data);
  custom.rules.push({
    id: "test-rule",
    type: "requires",
    if: { group: "engine", value: "nw-m1200" },
    then: { group: "warranty", value: "5y" },
    message: "Test message",
  });
  const twoYear = statusOf(getAvailability(custom, { engine: "nw-m1200" }), "warranty", "2y");
  assert.equal(twoYear.available, false);
  assert.equal(twoYear.reason, "Test message");
});

test("validation reports missing choices per step", () => {
  assert.equal(validateStep(data, {}, "engine").valid, false);
  assert.equal(validateStep(data, { engine: "nw-m500" }, "engine").valid, true);

  const options = validateStep(data, { cooling: "radiator" }, "options");
  assert.equal(options.valid, false);
  assert.ok(!options.missing.includes("cooling"));
  assert.ok(options.missing.includes("warranty"));
});

test("firstIncompleteStep finds where the user should continue", () => {
  assert.equal(firstIncompleteStep(data, {}), 0);
  assert.equal(firstIncompleteStep(data, { engine: "nw-m500" }), 1);
  assert.equal(firstIncompleteStep(data, FULL_CONFIG), -1);
});

test("checkDataIntegrity catches typos in rules", () => {
  const broken = structuredClone(data);
  must(broken.rules[0]).then.value = "advnced";
  // Deliberately invalid data. The type system forbids "forbids" (only
  // "excludes" | "requires" are allowed), so we have to opt out explicitly:
  // exactly the kind of mistake a typed codebase stops at compile time.
  Object.assign(must(broken.rules[1]), { type: "forbids" });
  const problems = checkDataIntegrity(broken);
  assert.equal(problems.length, 2);
});
