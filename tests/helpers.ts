// Shared test helpers: loads the real products.json, so the tests check
// the data the app actually ships with.
import { readFileSync } from "node:fs";
import type { Availability, ItemStatus, ProductData, Selections } from "../src/types.ts";

export function loadData(): ProductData {
  const url = new URL("../data/products.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as ProductData;
}

// A full, valid configuration used by several tests.
export const FULL_CONFIG: Readonly<Selections> = Object.freeze({
  engine: "nw-m500",
  fuel: "lng",
  cooling: "heat-exchanger",
  control: "advanced",
  aftertreatment: "none",
  enclosure: "yes",
  warranty: "5y",
});

// With "noUncheckedIndexedAccess", looking something up by key or with
// .find() may return undefined. These helpers fail the test with a clear
// message instead, and give the rest of the test a non-undefined value.
export function must<T>(value: T | undefined | null, what = "value"): T {
  if (value === undefined || value === null) throw new Error(`Expected ${what} to exist`);
  return value;
}

export function statusOf(availability: Availability, group: string, id: string): ItemStatus {
  return must(availability[group]?.[id], `availability.${group}.${id}`);
}
