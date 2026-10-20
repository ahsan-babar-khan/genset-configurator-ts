// pricing.ts - totals for price, power, weight and CO2.
// Pure functions only (no DOM), so they can be tested in Node.
// Every number comes from products.json; nothing is hard-coded here.

import { findItem, getAllGroups, getGroupLabel, getItemLabel } from "./rules.ts";
import type {
  Assumptions,
  Engine,
  Fuel,
  Line,
  ProductData,
  Quote,
  Selections,
  Totals,
  WeightAdjustment,
} from "./types.ts";

// g of CO2 per kWh produced, for one fuel.
// (fuel used per kWh) x (CO2 released per tonne of fuel burnt)
export function co2GramsPerKwh(fuel: Fuel): number {
  return fuel.fuelConsumptionGPerKwh * fuel.co2FactorTPerTFuel;
}

// Estimated tonnes of CO2 per year for an engine running on a fuel,
// using the running hours and load factor from data.assumptions.
export function annualCo2Tonnes(engine: Engine, fuel: Fuel, assumptions: Assumptions): number {
  const kWhPerYear = engine.powerKw * assumptions.averageLoadFactor * assumptions.annualRunningHours;
  return (kWhPerYear * co2GramsPerKwh(fuel)) / 1_000_000; // grams -> tonnes
}

// Weight added by modifiers such as "noise enclosure adds 8%".
// Each percentage is applied to the weight BEFORE modifiers, so two
// modifiers of 5% add 10%, not 10.25%. Simple and easy to explain to a customer.
export function weightAdjustments(
  data: ProductData,
  selections: Selections,
  baseWeightKg: number
): WeightAdjustment[] {
  return data.modifiers
    .filter((m) => selections[m.when.group] === m.when.value && m.effect.type === "weightPercent")
    .map((m) => ({
      id: m.id,
      label: m.label,
      weightKg: Math.round((baseWeightKg * m.effect.value) / 100),
    }));
}

// The main function: everything the summary panel and quote need.
// Works for partial configurations too (missing groups are just skipped).
export function calculateTotals(data: ProductData, selections: Selections): Totals {
  const lines: Line[] = [];

  for (const group of getAllGroups(data)) {
    const item = findItem(data, group, selections[group]);
    if (!item) continue;
    lines.push({
      group,
      groupLabel: getGroupLabel(data, group),
      id: item.id,
      label: getItemLabel(data, group, item.id),
      // Engines have a basePrice, everything else a price.
      price: "basePrice" in item ? item.basePrice : item.price,
      weightKg: item.weightKg ?? 0,
    });
  }

  const price = lines.reduce((sum, line) => sum + line.price, 0);
  const baseWeightKg = lines.reduce((sum, line) => sum + line.weightKg, 0);
  const adjustments = weightAdjustments(data, selections, baseWeightKg);
  const weightKg = baseWeightKg + adjustments.reduce((sum, a) => sum + a.weightKg, 0);

  const engine = data.engines.find((e) => e.id === selections.engine);
  const fuel = data.fuels.find((f) => f.id === selections.fuel);

  return {
    currency: data.meta.currency,
    lines,
    price,
    powerKw: engine ? engine.powerKw : null,
    baseWeightKg,
    adjustments,
    weightKg: engine ? weightKg : null, // no meaningful weight without an engine
    co2TonnesPerYear: engine && fuel ? Math.round(annualCo2Tonnes(engine, fuel, data.assumptions)) : null,
  };
}

// The downloadable quote. Pure: the date and share link are passed in,
// so the same inputs always give the same quote (easy to test).
export function buildQuote(
  data: ProductData,
  selections: Selections,
  { date, shareUrl }: { date: Date; shareUrl: string }
): Quote {
  const totals = calculateTotals(data, selections);
  return {
    company: data.meta.company,
    product: data.meta.product,
    createdAt: date.toISOString(),
    dataVersion: data.meta.dataVersion,
    currency: totals.currency,
    configuration: totals.lines,
    weightAdjustments: totals.adjustments,
    totals: {
      price: totals.price,
      powerKw: totals.powerKw,
      weightKg: totals.weightKg,
      co2TonnesPerYear: totals.co2TonnesPerYear,
    },
    assumptions: {
      annualRunningHours: data.assumptions.annualRunningHours,
      averageLoadFactor: data.assumptions.averageLoadFactor,
    },
    shareUrl,
    disclaimer: data.meta.disclaimer,
  };
}
