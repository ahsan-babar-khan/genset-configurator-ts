// types.ts - the shape of every piece of data in the app.
// These types exist only at compile time; they are erased from the
// JavaScript the browser runs.

// ---------------------------------------------------------------------------
// products.json
// ---------------------------------------------------------------------------

export interface Meta {
  company: string;
  product: string;
  currency: string; // ISO 4217 code, e.g. "EUR"
  dataVersion: string;
  disclaimer: string;
}

export interface Assumptions {
  annualRunningHours: number;
  averageLoadFactor: number; // 0..1
  note?: string;
}

export interface Engine {
  id: string;
  name: string;
  powerKw: number;
  cylinders: number;
  basePrice: number;
  weightKg: number;
  supportedFuels: string[]; // fuel ids
}

export interface Fuel {
  id: string;
  label: string;
  description: string;
  price: number;
  weightKg: number;
  fuelConsumptionGPerKwh: number;
  co2FactorTPerTFuel: number;
}

export interface Option {
  id: string;
  label: string;
  price: number;
  weightKg?: number; // optional: not every option changes the weight
}

export interface OptionGroup {
  id: string;
  label: string;
  required: boolean;
  options: Option[];
}

// "If <group> is <value>" / "then <group> <value>"
export interface Condition {
  group: string;
  value: string;
}

// A union of string literals: any other value is a compile error.
export type RuleType = "excludes" | "requires";

export interface Rule {
  id: string;
  type: RuleType;
  if: Condition;
  then: Condition;
  message: string;
}

export interface Modifier {
  id: string;
  when: Condition;
  effect: { type: "weightPercent"; value: number };
  label: string;
}

export interface ProductData {
  meta: Meta;
  assumptions: Assumptions;
  engines: Engine[];
  fuels: Fuel[];
  optionGroups: OptionGroup[];
  rules: Rule[];
  modifiers: Modifier[];
}

// Anything that can be picked in a group.
export type SelectableItem = Engine | Fuel | Option;

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

// Group id -> chosen item id, e.g. { engine: "nw-m500", fuel: "lng" }
export type Selections = Record<string, string>;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface ItemStatus {
  readonly available: boolean;
  readonly reason: string;
}

// Group id -> item id -> status
export type Availability = Record<string, Record<string, ItemStatus>>;

export interface Reset {
  group: string;
  value: string;
  reason: string;
}

export interface SanitizeResult {
  selections: Selections;
  resets: Reset[];
}

export interface ValidationResult {
  valid: boolean;
  missing: string[];
  message: string;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface Line {
  group: string;
  groupLabel: string;
  id: string;
  label: string;
  price: number;
  weightKg: number;
}

export interface WeightAdjustment {
  id: string;
  label: string;
  weightKg: number;
}

export interface Totals {
  currency: string;
  lines: Line[];
  price: number;
  // null = can't be known yet (e.g. no engine chosen). The compiler forces
  // every caller to handle that case before using the number.
  powerKw: number | null;
  baseWeightKg: number;
  adjustments: WeightAdjustment[];
  weightKg: number | null;
  co2TonnesPerYear: number | null;
}

export interface Quote {
  company: string;
  product: string;
  createdAt: string; // ISO 8601
  dataVersion: string;
  currency: string;
  configuration: Line[];
  weightAdjustments: WeightAdjustment[];
  totals: Pick<Totals, "price" | "powerKw" | "weightKg" | "co2TonnesPerYear">;
  assumptions: Pick<Assumptions, "annualRunningHours" | "averageLoadFactor">;
  shareUrl: string;
  disclaimer: string;
}
