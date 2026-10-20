// Tests for products.json itself. They run on every change to the data,
// so a bad edit (typo, impossible combination) fails before it ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDataIntegrity, getAvailability } from "../src/rules.ts";
import { loadData, must } from "./helpers.ts";

const data = loadData();

test("products.json has no broken references", () => {
  assert.deepEqual(checkDataIntegrity(data), []);
});

test("ids are unique within each group", () => {
  const groups = [data.engines, data.fuels, ...data.optionGroups.map((g) => g.options)];
  for (const items of groups) {
    const ids = items.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in: ${ids.join(", ")}`);
  }
});

test("prices and weights are non-negative numbers", () => {
  for (const engine of data.engines) {
    assert.ok(engine.basePrice > 0 && engine.weightKg > 0 && engine.powerKw > 0, engine.id);
  }
  for (const group of data.optionGroups) {
    for (const option of group.options) {
      assert.ok(Number.isFinite(option.price) && option.price >= 0, option.id);
      if (option.weightKg !== undefined) assert.ok(option.weightKg >= 0, option.id);
    }
  }
});

// The most valuable data test: for every engine + fuel the app allows,
// every required option group must still have at least one choice left.
// Otherwise a customer could get stuck with no way to finish.
test("every allowed engine + fuel combination can be completed", () => {
  for (const engine of data.engines) {
    for (const fuelId of engine.supportedFuels) {
      const availability = getAvailability(data, { engine: engine.id, fuel: fuelId });
      for (const group of data.optionGroups.filter((g) => g.required)) {
        const anyLeft = Object.values(must(availability[group.id], group.id)).some((s) => s.available);
        assert.ok(anyLeft, `${engine.id} + ${fuelId} leaves no option in "${group.id}"`);
      }
    }
  }
});
