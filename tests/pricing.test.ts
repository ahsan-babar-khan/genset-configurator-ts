import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateTotals, co2GramsPerKwh, annualCo2Tonnes, buildQuote } from "../src/pricing.ts";
import { loadData, FULL_CONFIG, must } from "./helpers.ts";

const data = loadData();

test("total price adds engine, fuel and every option", () => {
  // 112,000 + 22,000 + 7,500 + 9,800 + 0 + 12,000 + 8,900
  assert.equal(calculateTotals(data, FULL_CONFIG).price, 172200);
});

test("noise enclosure adds 8% to the weight", () => {
  const totals = calculateTotals(data, FULL_CONFIG);
  // 4,100 + 450 + 120 + 15 = 4,685 kg, +8% = 375 kg
  assert.equal(totals.baseWeightKg, 4685);
  assert.equal(must(totals.adjustments[0], "enclosure adjustment").weightKg, 375);
  assert.equal(totals.weightKg, 5060);

  const noEnclosure = calculateTotals(data, { ...FULL_CONFIG, enclosure: "no" });
  assert.equal(noEnclosure.weightKg, 4685);
});

test("CO2 estimate uses consumption, CO2 factor and the assumptions", () => {
  const lng = must(data.fuels.find((f) => f.id === "lng"), "LNG fuel");
  const m500 = must(data.engines.find((e) => e.id === "nw-m500"), "NW-M500 engine");
  assert.equal(co2GramsPerKwh(lng), 440); // 160 g/kWh x 2.75
  // 500 kW x 0.75 x 4,000 h x 440 g = 660 t
  assert.equal(annualCo2Tonnes(m500, lng, data.assumptions), 660);
  assert.equal(calculateTotals(data, FULL_CONFIG).co2TonnesPerYear, 660);
});

test("partial configurations give partial totals, with null for unknowns", () => {
  const empty = calculateTotals(data, {});
  assert.equal(empty.price, 0);
  assert.equal(empty.powerKw, null);
  assert.equal(empty.weightKg, null);
  assert.equal(empty.co2TonnesPerYear, null);

  const engineOnly = calculateTotals(data, { engine: "nw-m250" });
  assert.equal(engineOnly.price, 68000);
  assert.equal(engineOnly.co2TonnesPerYear, null); // no fuel yet
});

test("lines come out in display order: engine, fuel, then options", () => {
  const groups = calculateTotals(data, FULL_CONFIG).lines.map((l) => l.group);
  assert.deepEqual(groups, ["engine", "fuel", "cooling", "control", "aftertreatment", "enclosure", "warranty"]);
});

test("a price change in the data changes the total, with no code change", () => {
  const custom = structuredClone(data);
  must(custom.engines.find((e) => e.id === "nw-m500")).basePrice += 1000;
  assert.equal(calculateTotals(custom, FULL_CONFIG).price, 173200);
});

test("buildQuote is deterministic and contains the totals", () => {
  const options = { date: new Date("2026-01-01T00:00:00Z"), shareUrl: "https://example.test/?x" };
  const a = buildQuote(data, FULL_CONFIG, options);
  const b = buildQuote(data, FULL_CONFIG, options);
  assert.deepEqual(a, b);
  assert.equal(a.totals.price, 172200);
  assert.equal(a.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(a.configuration.length, 7);
});
