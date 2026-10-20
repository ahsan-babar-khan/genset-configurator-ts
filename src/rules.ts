// rules.ts - compatibility and validation logic.
// Pure functions only: they take product data and selections and return
// new values. No DOM access, so they can be tested in Node.
//
// "selections" is a flat object keyed by group id, e.g.
//   { engine: "nw-m500", fuel: "lng", cooling: "radiator" }
// A group with no choice yet is simply missing.

import type {
  Availability,
  ItemStatus,
  ProductData,
  Reset,
  SanitizeResult,
  SelectableItem,
  Selections,
  ValidationResult,
} from "./types.ts";

// The order of the steps in the form. This is app structure, not product data.
// `as const` makes the array read-only and keeps the exact strings as types.
export const STEPS = ["engine", "fuel", "options", "summary"] as const;

// Derived from the array: "engine" | "fuel" | "options" | "summary".
// Adding a step to STEPS updates this type automatically.
export type StepId = (typeof STEPS)[number];

const AVAILABLE: ItemStatus = Object.freeze({ available: true, reason: "" });

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

// Every selection group, in display order: engine, fuel, then option groups.
export function getAllGroups(data: ProductData): string[] {
  return ["engine", "fuel", ...data.optionGroups.map((g) => g.id)];
}

// All selectable items of a group, whatever kind of group it is.
export function getGroupItems(data: ProductData, group: string): readonly SelectableItem[] {
  if (group === "engine") return data.engines;
  if (group === "fuel") return data.fuels;
  const optionGroup = data.optionGroups.find((g) => g.id === group);
  return optionGroup ? optionGroup.options : [];
}

export function findItem(data: ProductData, group: string, id: string | undefined): SelectableItem | null {
  if (id === undefined) return null;
  return getGroupItems(data, group).find((item) => item.id === id) ?? null;
}

// Engines have a "name", everything else has a "label".
// The `in` check narrows the union type, so each branch is type-safe.
export function getItemLabel(data: ProductData, group: string, id: string): string {
  const item = findItem(data, group, id);
  if (!item) return id;
  return "name" in item ? item.name : item.label;
}

export function getGroupLabel(data: ProductData, group: string): string {
  if (group === "engine") return "Engine";
  if (group === "fuel") return "Fuel";
  const optionGroup = data.optionGroups.find((g) => g.id === group);
  return optionGroup ? optionGroup.label : group;
}

// Which selection groups each step is responsible for.
export function getStepGroups(data: ProductData, step: StepId): string[] {
  switch (step) {
    case "engine":
      return ["engine"];
    case "fuel":
      return ["fuel"];
    case "options":
      return data.optionGroups.filter((g) => g.required).map((g) => g.id);
    case "summary":
      return [];
  }
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

// Works out, for every item in every group, whether it can be chosen with
// the current selections, and if not, why. Shape of the result:
//   { fuel: { lng: { available: false, reason: "Not supported by ..." } } }
export function getAvailability(data: ProductData, selections: Selections): Availability {
  const engine = data.engines.find((e) => e.id === selections.engine);
  const availability: Availability = {};

  availability.engine = Object.fromEntries(data.engines.map((e) => [e.id, AVAILABLE]));

  availability.fuel = Object.fromEntries(
    data.fuels.map((fuel): [string, ItemStatus] => {
      if (engine && !engine.supportedFuels.includes(fuel.id)) {
        return [fuel.id, { available: false, reason: `Not supported by the ${engine.name}.` }];
      }
      return [fuel.id, AVAILABLE];
    })
  );

  for (const group of data.optionGroups) {
    availability[group.id] = Object.fromEntries(group.options.map((o) => [o.id, AVAILABLE]));
  }

  applyRules(data, selections, availability);
  return availability;
}

// The rule engine. Walks the "rules" list from products.json and disables
// items in the availability map. There is no product-specific code here:
// a new rule in the JSON works without touching this function.
//
//   excludes: if X is selected, the "then" item is disabled
//   requires: if X is selected, every OTHER item in the "then" group is disabled
function applyRules(data: ProductData, selections: Selections, availability: Availability): void {
  for (const rule of data.rules) {
    if (selections[rule.if.group] !== rule.if.value) continue; // rule not triggered

    const targetGroup = availability[rule.then.group];
    if (!targetGroup) continue;

    let blockedIds: string[];
    if (rule.type === "excludes") {
      blockedIds = [rule.then.value];
    } else if (rule.type === "requires") {
      blockedIds = Object.keys(targetGroup).filter((id) => id !== rule.then.value);
    } else {
      // The types say this can't happen, but products.json is loaded at
      // runtime and could contain anything. checkDataIntegrity() reports it.
      continue;
    }

    for (const id of blockedIds) {
      const status = targetGroup[id];
      if (status) targetGroup[id] = disable(status, rule.message);
    }
  }
}

// Marks an item unavailable. If several rules block the same item, all
// their reasons are kept.
function disable(status: ItemStatus, reason: string): ItemStatus {
  if (status.available) return { available: false, reason };
  if (status.reason.includes(reason)) return status;
  return { available: false, reason: `${status.reason} ${reason}` };
}

// Selections that are no longer allowed (or no longer exist in the data).
export function findInvalidSelections(data: ProductData, selections: Selections): Reset[] {
  const availability = getAvailability(data, selections);
  const invalid: Reset[] = [];

  for (const [group, value] of Object.entries(selections)) {
    const status = availability[group]?.[value];
    if (!status) {
      invalid.push({ group, value, reason: "This choice is no longer offered." });
    } else if (!status.available) {
      invalid.push({ group, value, reason: status.reason });
    }
  }
  return invalid;
}

// Removes invalid selections. Returns the cleaned selections plus a list of
// what was removed, so the UI can tell the user.
// One pass is enough: removing a choice can only lift restrictions, never
// create new ones, because rules only trigger on things that are selected.
export function sanitizeSelections(data: ProductData, selections: Selections): SanitizeResult {
  const resets = findInvalidSelections(data, selections);
  const cleaned: Selections = { ...selections };
  for (const { group } of resets) delete cleaned[group];
  return { selections: cleaned, resets };
}

// Applies one user choice and resolves any knock-on effects.
export function applySelection(
  data: ProductData,
  selections: Selections,
  group: string,
  value: string
): SanitizeResult {
  return sanitizeSelections(data, { ...selections, [group]: value });
}

// Human-readable text for a reset, e.g.
//   'Fuel "LNG" was cleared: Not supported by the NW-M250 Compact.'
export function describeReset(data: ProductData, { group, value, reason }: Reset): string {
  return `${getGroupLabel(data, group)} "${getItemLabel(data, group, value)}" was cleared: ${reason}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Checks that every required group of a step has a choice.
export function validateStep(data: ProductData, selections: Selections, step: StepId): ValidationResult {
  const missing = getStepGroups(data, step).filter((group) => !selections[group]);
  if (missing.length === 0) return { valid: true, missing, message: "" };

  let message: string;
  if (step === "engine") message = "Please choose an engine to continue.";
  else if (step === "fuel") message = "Please choose a fuel type to continue.";
  else message = `Please make a choice for: ${missing.map((g) => getGroupLabel(data, g)).join(", ")}.`;

  return { valid: false, missing, message };
}

// The first step that still has missing choices, or -1 if all are complete.
export function firstIncompleteStep(data: ProductData, selections: Selections): number {
  return STEPS.findIndex((step) => !validateStep(data, selections, step).valid);
}

// ---------------------------------------------------------------------------
// Data integrity
// ---------------------------------------------------------------------------

// Catches typos in products.json, e.g. a rule pointing at an option id that
// doesn't exist. Types can't do this: they check code at compile time, but
// the JSON is loaded at runtime. Returns a list of problems (empty = fine).
export function checkDataIntegrity(data: ProductData): string[] {
  const problems: string[] = [];
  const exists = (group: string, id: string) => findItem(data, group, id) !== null;
  const ruleTypes: readonly string[] = ["excludes", "requires"];

  for (const engine of data.engines) {
    for (const fuel of engine.supportedFuels) {
      if (!exists("fuel", fuel)) problems.push(`Engine "${engine.id}" lists unknown fuel "${fuel}".`);
    }
  }
  for (const rule of data.rules) {
    if (!ruleTypes.includes(rule.type)) {
      problems.push(`Rule "${rule.id}" has unknown type "${rule.type}".`);
    }
    for (const cond of [rule.if, rule.then]) {
      if (!exists(cond.group, cond.value)) {
        problems.push(`Rule "${rule.id}" refers to unknown ${cond.group} "${cond.value}".`);
      }
    }
  }
  for (const mod of data.modifiers) {
    if (!exists(mod.when.group, mod.when.value)) {
      problems.push(`Modifier "${mod.id}" refers to unknown ${mod.when.group} "${mod.when.value}".`);
    }
  }
  return problems;
}
