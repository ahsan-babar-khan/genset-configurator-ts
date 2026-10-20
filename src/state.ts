// state.ts - the single source of truth for the current configuration.
// Holds the user's selections and the current step. Other modules never
// change these directly: they call the methods below, and anything that
// subscribed is told to re-render.
//
// Also converts the configuration to and from the two places it is kept
// outside memory: localStorage (save/load) and the URL (shareable link).

import type { Selections } from "./types.ts";

export type Listener = () => void;

// The public interface of the store. Callers can only use these methods;
// the variables inside createState() are private (a closure).
export interface Store {
  getSelections(): Selections;
  getStep(): number;
  setSelections(next: Selections): void;
  setStep(index: number): void;
  reset(): void;
  subscribe(listener: Listener): () => void;
}

export function createState({
  selections: initialSelections = {},
  step: initialStep = 0,
}: { selections?: Selections; step?: number } = {}): Store {
  let selections: Selections = { ...initialSelections };
  let step = initialStep;
  const listeners = new Set<Listener>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  return {
    getSelections() {
      return { ...selections }; // a copy, so callers can't mutate state by accident
    },

    getStep() {
      return step;
    },

    setSelections(next) {
      selections = { ...next };
      notify();
    },

    setStep(index) {
      if (index === step) return;
      step = index;
      notify();
    },

    reset() {
      selections = {};
      step = 0;
      notify();
    },

    // Returns an unsubscribe function.
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---------------------------------------------------------------------------
// Shareable link (URL query string)
// ---------------------------------------------------------------------------

// { engine: "nw-m500", fuel: "lng" } -> "engine=nw-m500&fuel=lng"
// `groups` fixes the order, so the same configuration always gives the same link.
export function selectionsToQuery(selections: Selections, groups: readonly string[]): string {
  const params = new URLSearchParams();
  for (const group of groups) {
    const value = selections[group];
    if (value) params.set(group, value);
  }
  return params.toString();
}

// "?engine=nw-m500&fuel=lng&utm_source=x" -> { engine: "nw-m500", fuel: "lng" }
// Unknown keys are ignored. Values are NOT trusted here: the caller must run
// them through sanitizeSelections() because anyone can edit a URL.
export function selectionsFromQuery(search: string, groups: readonly string[]): Selections {
  const params = new URLSearchParams(search);
  const selections: Selections = {};
  for (const group of groups) {
    const value = params.get(group);
    if (value) selections[group] = value;
  }
  return selections;
}

// ---------------------------------------------------------------------------
// Save / load (localStorage)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "genset-configurator:v1";

interface SavedRecord {
  selections: Selections;
  dataVersion: string;
  savedAt: string;
}

// localStorage can throw: it may be disabled, full, or blocked in private
// browsing, and the stored text may be corrupted. Saving is a convenience,
// so every failure is caught and the app keeps working without it.
export function saveConfiguration(selections: Selections, dataVersion: string): boolean {
  try {
    if (Object.keys(selections).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    }
    const record: SavedRecord = { selections, dataVersion, savedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch (error) {
    console.warn("Could not save configuration:", error);
    return false;
  }
}

// Returns the saved selections, or null if there is nothing usable.
// JSON.parse returns `any`, so the result is treated as `unknown` and
// checked step by step before TypeScript lets us use it.
export function loadConfiguration(): Selections | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const record: unknown = JSON.parse(raw);
    if (typeof record !== "object" || record === null || !("selections" in record)) return null;

    const selections = record.selections;
    if (typeof selections !== "object" || selections === null || Array.isArray(selections)) return null;

    // Keep only string values; anything else is not something we wrote.
    return Object.fromEntries(
      Object.entries(selections).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch (error) {
    console.warn("Could not load saved configuration:", error);
    return null;
  }
}

export function clearSavedConfiguration(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Could not clear saved configuration:", error);
  }
}
