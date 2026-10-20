// ui.ts - everything that touches the DOM.
// Two kinds of functions:
//   build*  create elements once, when the data has loaded
//   update* change existing elements (checked, disabled, text) on every
//           state change. Updating in place, instead of rebuilding, keeps
//           keyboard focus where it is while the user arrows through radios.

import { STEPS, type StepId } from "./rules.ts";
import { co2GramsPerKwh } from "./pricing.ts";
import type { Availability, Meta, ProductData, Selections, Totals } from "./types.ts";

// ---------------------------------------------------------------------------
// DOM lookup
// ---------------------------------------------------------------------------

// getElementById can return null. Instead of checking for null everywhere,
// fail loudly once with a clear message if the HTML and the code disagree.
// The generic <T> lets callers say which element type they expect:
//   byId<HTMLButtonElement>("btn-next").disabled = true;
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id} in index.html`);
  return element as T;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export interface Formatters {
  money(value: number): string;
  number(value: number): string;
  extra(value: number): string;
}

export function createFormatters(meta: Meta): Formatters {
  const money = new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: meta.currency,
    maximumFractionDigits: 0,
  });
  const number = new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 });

  return {
    money: (value) => money.format(value),
    number: (value) => number.format(value),
    // Price of an add-on relative to the base: "+€9,800" or "Included"
    extra: (value) => (value > 0 ? `+${money.format(value)}` : "Included"),
  };
}

// ---------------------------------------------------------------------------
// Element helper
// ---------------------------------------------------------------------------

// Small createElement wrapper. Text is always set with textContent, never
// innerHTML, so data from the JSON or URL can't inject HTML.
// The return type follows the tag: el("input") is an HTMLInputElement.
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

// ---------------------------------------------------------------------------
// Choice cards
// ---------------------------------------------------------------------------

interface ChoiceProps {
  name: string;
  id: string;
  title: string;
  lines?: string[];
  price: string;
}

// One radio card. `lines` are extra text lines under the title.
function buildChoice({ name, id, title, lines = [], price }: ChoiceProps): HTMLLabelElement {
  const inputId = `${name}-${id}`;
  const input = el("input", { type: "radio", name, value: id, id: inputId });

  const body = el("span", { class: "choice__body" }, [
    el("span", { class: "choice__title", text: title }),
    ...lines.map((line) => el("span", { class: "choice__meta", text: line })),
    el("span", { class: "choice__price", text: price }),
    el("span", { class: "choice__reason", id: `${inputId}-reason`, hidden: "" }),
  ]);

  return el("label", { class: "choice", for: inputId }, [input, body]);
}

export function buildEngineChoices(container: HTMLElement, data: ProductData, fmt: Formatters): void {
  const fuelLabel = (id: string) => data.fuels.find((f) => f.id === id)?.label ?? id;

  container.replaceChildren(
    ...data.engines.map((engine) =>
      buildChoice({
        name: "engine",
        id: engine.id,
        title: engine.name,
        lines: [
          `${fmt.number(engine.powerKw)} kW · ${engine.cylinders} cylinders · ${fmt.number(engine.weightKg)} kg`,
          `Fuels: ${engine.supportedFuels.map(fuelLabel).join(", ")}`,
        ],
        price: fmt.money(engine.basePrice),
      })
    )
  );
}

export function buildFuelChoices(container: HTMLElement, data: ProductData, fmt: Formatters): void {
  container.replaceChildren(
    ...data.fuels.map((fuel) =>
      buildChoice({
        name: "fuel",
        id: fuel.id,
        title: fuel.label,
        lines: [fuel.description, `≈ ${fmt.number(co2GramsPerKwh(fuel))} g CO2 per kWh`],
        price: fmt.extra(fuel.price),
      })
    )
  );
}

// One <fieldset> per option group, each with its own radio cards.
// Weight changes and modifiers (e.g. "+8% total weight") come from the JSON.
export function buildOptionGroups(container: HTMLElement, data: ProductData, fmt: Formatters): void {
  const modifierLines = (groupId: string, optionId: string) =>
    data.modifiers.filter((m) => m.when.group === groupId && m.when.value === optionId).map((m) => m.label);

  container.replaceChildren(
    ...data.optionGroups.map((group) => {
      const cards = group.options.map((option) =>
        buildChoice({
          name: group.id,
          id: option.id,
          title: option.label,
          lines: [
            ...(option.weightKg ? [`+${fmt.number(option.weightKg)} kg`] : []),
            ...modifierLines(group.id, option.id),
          ],
          price: fmt.extra(option.price),
        })
      );

      return el("fieldset", { class: "option-group", "data-group": group.id, "aria-describedby": "options-error" }, [
        el("legend", { text: group.label }),
        el("div", { class: "choices__grid" }, cards),
      ]);
    })
  );
}

// Syncs every radio in the form with the state: checked, disabled, and the
// "why disabled" text, which is linked to the input with aria-describedby.
export function updateChoices(form: HTMLFormElement, selections: Selections, availability: Availability): void {
  for (const input of form.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    const status = availability[input.name]?.[input.value] ?? { available: true, reason: "" };
    const reason = document.getElementById(`${input.id}-reason`);

    input.checked = selections[input.name] === input.value;
    input.disabled = !status.available;

    if (reason) {
      reason.textContent = status.reason;
      reason.hidden = status.available;
    }
    if (status.available || !reason) input.removeAttribute("aria-describedby");
    else input.setAttribute("aria-describedby", reason.id);
  }
}

// ---------------------------------------------------------------------------
// Steps and progress
// ---------------------------------------------------------------------------

export function updateSteps(stepIndex: number): void {
  STEPS.forEach((step, i) => {
    byId(`step-${step}`).hidden = i !== stepIndex;
  });

  document.querySelectorAll<HTMLElement>(".progress__item").forEach((item, i) => {
    item.classList.toggle("is-complete", i < stepIndex);
    // Colour alone shows "done" on screen; screen readers need words.
    const status = item.querySelector<HTMLElement>(".progress__status");
    if (status) setText(status, i < stepIndex ? " (completed)" : "");
    if (i === stepIndex) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });

  const next = byId<HTMLButtonElement>("btn-next");
  byId("btn-back").hidden = stepIndex === 0;
  next.hidden = stepIndex === STEPS.length - 1;
  next.textContent = stepIndex === STEPS.length - 2 ? "Review quote" : "Next";
}

// Moves focus to the new step's heading, so screen-reader and keyboard
// users start at the top of the step instead of on a now-hidden button.
export function focusStepHeading(stepIndex: number): void {
  const step = STEPS[stepIndex];
  if (step) byId(`step-${step}-title`).focus();
}

// ---------------------------------------------------------------------------
// Live summary and review
// ---------------------------------------------------------------------------

// Only touch the DOM when the text really changes. Rewriting the same text
// inside an aria-live region can make screen readers announce it again.
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

const DASH = "–";

export function updateSummary(totals: Totals, fmt: Formatters): void {
  setText(byId("sum-price"), fmt.money(totals.price));
  setText(byId("sum-power"), totals.powerKw === null ? DASH : `${fmt.number(totals.powerKw)} kW`);
  setText(byId("sum-weight"), totals.weightKg === null ? DASH : `${fmt.number(totals.weightKg)} kg`);
  setText(
    byId("sum-co2"),
    totals.co2TonnesPerYear === null ? "Choose engine and fuel" : `≈ ${fmt.number(totals.co2TonnesPerYear)} t`
  );

  // e.g. "incl. +375 kg: Noise enclosure adds 8% to total weight"
  const detail = byId("sum-weight-detail");
  const adjustmentText = totals.adjustments
    .map((a) => `incl. +${fmt.number(a.weightKg)} kg: ${a.label}`)
    .join(" ");
  setText(detail, totals.weightKg === null ? "" : adjustmentText);
  detail.hidden = detail.textContent === "";

  const items =
    totals.lines.length === 0
      ? [el("li", { class: "summary__empty", text: "Nothing selected yet." })]
      : totals.lines.map((line) =>
          el("li", {}, [
            el("span", { text: `${line.groupLabel}: ${line.label}` }),
            el("span", { class: "summary__item-price", text: fmt.money(line.price) }),
          ])
        );
  byId("summary-items").replaceChildren(...items);
}

// The table on step 4: one row per selection, then the totals.
export function updateReview(totals: Totals, fmt: Formatters): void {
  const row = (term: string, value: string, price = "", modifier = ""): HTMLElement[] => [
    el("dt", { class: modifier, text: term }),
    el("dd", { class: modifier }, [
      el("span", { text: value }),
      el("span", { class: "review-list__price", text: price }),
    ]),
  ];

  const rows = totals.lines.flatMap((line) => row(line.groupLabel, line.label, fmt.money(line.price)));
  if (totals.powerKw !== null) rows.push(...row("Power", `${fmt.number(totals.powerKw)} kW`));
  if (totals.weightKg !== null) rows.push(...row("Weight", `${fmt.number(totals.weightKg)} kg`));
  if (totals.co2TonnesPerYear !== null) {
    rows.push(...row("Est. CO2 per year", `≈ ${fmt.number(totals.co2TonnesPerYear)} tonnes`));
  }
  rows.push(...row("Total price", "", fmt.money(totals.price), "review-list__total"));

  byId("review-list").replaceChildren(...rows);
}

// Text that comes from products.json but never changes while the page is open.
export function setStaticText(data: ProductData, fmt: Formatters): void {
  const { annualRunningHours, averageLoadFactor } = data.assumptions;
  const note =
    `CO2 estimate assumes ${fmt.number(annualRunningHours)} running hours per year ` +
    `at ${Math.round(averageLoadFactor * 100)}% average load.`;

  byId("summary-note").textContent = note;
  byId("review-note").textContent = note;
  byId("disclaimer").textContent = data.meta.disclaimer;
  byId("print-company").textContent = data.meta.company;
}

// ---------------------------------------------------------------------------
// Export, share and print
// ---------------------------------------------------------------------------

// Creates a file in memory (Blob) and clicks a temporary download link.
export function downloadFile(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  // Free the memory once the browser has started the download. Revoking
  // immediately can cancel it in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The Clipboard API only works on https or localhost and can be refused by
// the user, so failure is expected and handled by the caller.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.warn("Clipboard not available:", error);
    return false;
  }
}

export function setPrintLink(url: string): void {
  setText(byId("print-link"), url);
}

export function setPrintDate(date: Date): void {
  byId("print-date").textContent = date.toLocaleDateString("en-IE", { dateStyle: "long" });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function showStepError(step: StepId, message: string): void {
  byId(`${step}-error`).textContent = message;
}

export function clearStepErrors(): void {
  for (const step of STEPS) {
    const box = document.getElementById(`${step}-error`); // the summary step has none
    if (box) box.textContent = "";
  }
  markMissingGroups([]);
}

// Highlights the option groups that still need a choice, so the user can
// see them without scrolling down to the error message.
export function markMissingGroups(groups: readonly string[]): void {
  for (const fieldset of document.querySelectorAll<HTMLFieldSetElement>(".option-group")) {
    fieldset.classList.toggle("is-missing", groups.includes(fieldset.dataset.group ?? ""));
  }
}

export function hasMissingGroups(): boolean {
  return document.querySelector(".option-group.is-missing") !== null;
}

// Puts focus on the first selectable radio of a group, used after a
// validation error so the user lands right where the fix is needed.
export function focusGroup(form: HTMLFormElement, group: string): void {
  form.querySelector<HTMLInputElement>(`input[name="${group}"]:not(:disabled)`)?.focus();
}

export function showNotice(messages: readonly string[]): void {
  byId("notice").textContent = messages.join(" ");
}

export function clearNotice(): void {
  byId("notice").textContent = "";
}

export function showLoadError(message: string): void {
  const box = el("p", { class: "load-error", role: "alert", text: message });
  byId("engine-choices").replaceChildren(box);
  byId<HTMLButtonElement>("btn-next").disabled = true;
}
