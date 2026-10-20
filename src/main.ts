// main.ts - entry point. Loads the product data, creates the state, and
// connects user events -> rules -> state -> UI. Contains no product
// knowledge itself: every option, price and rule comes from products.json.

import {
  createState,
  selectionsToQuery,
  selectionsFromQuery,
  saveConfiguration,
  loadConfiguration,
  clearSavedConfiguration,
} from "./state.ts";
import {
  STEPS,
  getAllGroups,
  getAvailability,
  applySelection,
  sanitizeSelections,
  describeReset,
  validateStep,
  firstIncompleteStep,
  checkDataIntegrity,
} from "./rules.ts";
import { calculateTotals, buildQuote } from "./pricing.ts";
import * as ui from "./ui.ts";
import type { ProductData, Reset, Selections } from "./types.ts";

const DATA_URL = "data/products.json";

// response.json() returns `any`. The cast below tells TypeScript to trust
// that the file matches ProductData; it does NOT check it at runtime.
// That's why checkDataIntegrity() still runs after loading, and why the
// data tests check products.json before every deploy.
async function loadData(): Promise<ProductData> {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${DATA_URL}`);
  return (await response.json()) as ProductData;
}

// "2026-10-20" in the user's own time zone. (toISOString() would give the
// UTC date, which is the wrong day for part of the day outside UTC.)
function localDateStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface Restored {
  selections: Selections;
  step: number;
  source: "link" | "saved" | null;
  resets: Reset[];
}

// Where to start: a shared link wins over a saved configuration, so opening
// someone's link always shows their setup. Whatever the source, the values
// are cleaned, because a URL or old save may contain invalid or deleted ids.
function restoreConfiguration(data: ProductData): Restored {
  const groups = getAllGroups(data);
  const fromUrl = selectionsFromQuery(window.location.search, groups);

  let source: Restored["source"] = null;
  let raw: Selections = {};
  if (Object.keys(fromUrl).length > 0) {
    source = "link";
    raw = fromUrl;
  } else {
    const saved = loadConfiguration();
    if (saved && Object.keys(saved).length > 0) {
      source = "saved";
      raw = saved;
    }
  }

  const { selections, resets } = sanitizeSelections(data, raw);

  // Open the first step that still needs input, or the summary if complete.
  const incomplete = firstIncompleteStep(data, selections);
  const step = incomplete === -1 ? STEPS.length - 1 : incomplete;

  return { selections, step, source, resets };
}

async function init(): Promise<void> {
  let data: ProductData;
  try {
    data = await loadData();
  } catch (error) {
    console.error(error);
    ui.showLoadError(
      "Sorry, the product data could not be loaded. If you opened index.html " +
        "straight from disk, run it through a local server such as VS Code Live Server."
    );
    return;
  }

  // Warn (don't crash) if someone made a typo while editing the JSON.
  for (const problem of checkDataIntegrity(data)) console.warn("[products.json]", problem);

  const form = ui.byId<HTMLFormElement>("config-form");

  const groups = getAllGroups(data);
  const fmt = ui.createFormatters(data.meta);

  const restored = restoreConfiguration(data);
  const state = createState({ selections: restored.selections, step: restored.step });

  ui.buildEngineChoices(ui.byId("engine-choices"), data, fmt);
  ui.buildFuelChoices(ui.byId("fuel-choices"), data, fmt);
  ui.buildOptionGroups(ui.byId("option-groups"), data, fmt);
  ui.setStaticText(data, fmt);

  // The full shareable link for the current configuration.
  function shareUrl(): string {
    const url = new URL(window.location.href);
    url.search = selectionsToQuery(state.getSelections(), groups);
    url.hash = "";
    return url.toString();
  }

  // Re-render from state on every change.
  function render(): void {
    const selections = state.getSelections();
    const totals = calculateTotals(data, selections);
    ui.updateChoices(form, selections, getAvailability(data, selections));
    ui.updateSteps(state.getStep());
    ui.updateSummary(totals, fmt);
    ui.updateReview(totals, fmt);
    ui.setPrintLink(shareUrl());
  }

  // Keep localStorage and the address bar in sync with the state.
  // replaceState (not pushState) so every click doesn't add a Back-button entry.
  function persist(): void {
    saveConfiguration(state.getSelections(), data.meta.dataVersion);
    window.history.replaceState(null, "", shareUrl());
  }

  // --- Events -------------------------------------------------------------

  // One listener for the whole form (event delegation) instead of one per radio.
  form.addEventListener("change", (event) => {
    const input = event.target;
    // event.target is typed as EventTarget | null. The instanceof check
    // narrows it to HTMLInputElement, so .name and .value are safe to use.
    if (!(input instanceof HTMLInputElement) || input.type !== "radio") return;

    const { selections, resets } = applySelection(data, state.getSelections(), input.name, input.value);
    state.setSelections(selections);

    // Clear the error message, but keep highlighting groups that are still empty.
    const stillMissing = ui.hasMissingGroups();
    ui.clearStepErrors();
    if (stillMissing) ui.markMissingGroups(validateStep(data, selections, "options").missing);

    if (resets.length > 0) ui.showNotice(resets.map((r) => describeReset(data, r)));
    else ui.clearNotice();
  });

  function goToStep(index: number): void {
    ui.clearStepErrors();
    ui.clearNotice();
    state.setStep(index);
    ui.focusStepHeading(index);
  }

  ui.byId("btn-next").addEventListener("click", () => {
    const index = state.getStep();
    const step = STEPS[index];
    if (!step) return;
    const result = validateStep(data, state.getSelections(), step);

    if (!result.valid) {
      ui.showStepError(step, result.message);
      ui.markMissingGroups(result.missing);
      const firstMissing = result.missing[0];
      if (firstMissing) ui.focusGroup(form, firstMissing);
      return;
    }
    goToStep(index + 1);
  });

  ui.byId("btn-back").addEventListener("click", () => {
    goToStep(Math.max(0, state.getStep() - 1));
  });

  // Quote actions need a complete configuration. The summary step can only
  // be reached when complete, but a check here keeps them safe regardless.
  function ensureComplete(): boolean {
    const incomplete = firstIncompleteStep(data, state.getSelections());
    if (incomplete === -1) return true;
    goToStep(incomplete);
    ui.showNotice(["Please complete your configuration first."]);
    return false;
  }

  ui.byId("btn-download").addEventListener("click", () => {
    if (!ensureComplete()) return;
    const now = new Date();
    const quote = buildQuote(data, state.getSelections(), { date: now, shareUrl: shareUrl() });
    const filename = `genset-quote-${localDateStamp(now)}.json`;
    ui.downloadFile(filename, JSON.stringify(quote, null, 2), "application/json");
    ui.showNotice([`Quote downloaded as ${filename}.`]);
  });

  ui.byId("btn-print").addEventListener("click", () => {
    if (!ensureComplete()) return;
    window.print();
  });

  ui.byId("btn-share").addEventListener("click", async () => {
    const url = shareUrl();
    const copied = await ui.copyToClipboard(url);
    ui.showNotice([copied ? "Link copied to clipboard." : `Copy this link to share your configuration: ${url}`]);
  });

  ui.byId("btn-reset").addEventListener("click", () => {
    if (!window.confirm("Start over? Your current configuration will be cleared.")) return;
    clearSavedConfiguration();
    state.reset();
    goToStep(0);
    ui.showNotice(["Configuration cleared."]);
  });

  // Stamp the print-out with the current date, also for Ctrl+P.
  window.addEventListener("beforeprint", () => ui.setPrintDate(new Date()));

  state.subscribe(render);
  state.subscribe(persist);
  render();
  persist();

  // Tell the user what was restored, and what had to be dropped.
  if (restored.source) {
    const intro =
      restored.source === "link"
        ? "Configuration loaded from the shared link."
        : "Welcome back: your last configuration was restored.";
    ui.showNotice([intro, ...restored.resets.map((r) => describeReset(data, r))]);
  }
}

init();
