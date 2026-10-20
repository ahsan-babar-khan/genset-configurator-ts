# Learning notes

What each stage built, why it was built that way, and what to say about it in an interview.
Read these after the project is finished, alongside the code.

---

## Stage 1: Project setup and data model

**Files:** `data/products.json`, `.gitignore`, `.gitattributes`, `README.md`

### products.json design decisions
1. **Everything is referenced by `id`, not by display text.** Rules say `"value": "methanol"`, not `"Methanol"`.
   Labels can change without breaking rules, saved configs or share links.
2. **Units are in field names** (`powerKw`, `weightKg`, `co2FactorTPerTFuel`), so nobody guesses whether a weight is kg or tonnes.
3. **Rules are data.** Two types:
   - `excludes`: if X is chosen, option Y is disabled (LNG → no SCR).
   - `requires`: if X is chosen, only option Y is allowed in that group (methanol → advanced control).
   Every rule has the same shape (`if` → `then` → `message`), so `rules.js` is one generic loop with no product-specific `if` statements.
4. **Engine–fuel compatibility** lives on the engine as `supportedFuels`.
5. **Modifiers are separate from rules.** "Enclosure adds 8% weight" doesn't block anything, it changes a calculation, so `pricing.js` reads it, not `rules.js`.
6. **CO2 assumptions are in the data** (running hours, load factor), so the estimate is transparent.
   Formula: kW × load factor × hours × g/kWh × CO2 factor ÷ 1,000,000 = tonnes CO2 per year.
7. **Every group is `required` with no default**, which gives validation something to enforce.

### How to trace a rule by hand
Search the JSON for the ID you picked (e.g. `nw-m250`). Every hit is something that choice affects.
NW-M250 + Methanol fires two rules: `m250-no-heat-exchanger` (Cooling) and `methanol-needs-advanced-control` (Control).

### Git
- `git init -b main` uses the modern default branch name.
- `.gitattributes` with `eol=lf`: Windows uses CRLF line endings, Mac/Linux use LF. Normalising them stops diffs where every line looks changed.
- Conventional commit prefixes (`feat:`, `fix:`, `style:`, `docs:`, `test:`, `chore:`), one commit per finished feature, so the history reads like a changelog and features can be reverted cleanly.

---

## Stage 2: Static HTML layout and CSS

**Files:** `index.html`, `css/styles.css`

### HTML structure (semantic elements)
| Element | Why |
|---|---|
| `<header>`, `<main>`, `<aside>`, `<footer>`, `<nav>` | Landmarks: screen-reader users can jump between them |
| `<a class="skip-link">` | First Tab stop; lets keyboard users skip the header |
| `<ol>` for the progress indicator | Steps are an ordered list; `aria-current="step"` marks the current one |
| `<form novalidate>` | We do our own validation messages instead of the browser's popups |
| `<section hidden>` per step | Only one step visible; `hidden` also removes it from the accessibility tree |
| `<fieldset>` + `<legend>` | Groups radio buttons so a screen reader says "Engine model, radio group" |
| `<label>` wrapping each `<input type="radio">` | Clicking the whole card selects it; arrow keys move between options for free |
| `<dl>` (`dt`/`dd`) in the summary | Name/value pairs: "Power: 500 kW" |
| `aria-live="polite"` on the total and the notice | Screen readers announce changes without the user moving focus |
| `aria-describedby` on disabled inputs | Links the input to its "why disabled" text so it is read out |
| `tabindex="-1"` on step headings | Lets JS move focus to the new step's heading after Next/Back |

The engine step contains **placeholder cards** so the styles can be reviewed. Stage 3 replaces them with cards generated from `products.json`. The HTML has no real product data.

### CSS techniques
- **Custom properties (design tokens)** in `:root`: colours, spacing, radius. Dark mode is one `@media (prefers-color-scheme: dark)` block that only changes colour tokens, and every component follows.
- **Mobile-first layout:** the default is one column. `@media (min-width: 60rem)` switches `.layout` to a two-column **Grid** (`minmax(0, 1fr) 22rem`) and makes the summary `position: sticky`.
- **Responsive cards without media queries:** `grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr))` fits as many 14rem cards per row as there is room for. `min(100%, …)` prevents overflow on very small screens.
- **Flexbox** for one-dimensional layouts (header, buttons, card contents). **Grid** for two-dimensional ones (page, cards, summary figures).
- **`:has()`** styles the card based on its radio: `.choice:has(input:checked)`, `.choice:has(input:disabled)`, `.choice:has(input:focus-visible)`. No JS needed for visual state.
- **`:focus-visible`** shows a clear orange focus ring for keyboard users without showing it on mouse clicks.
- **`[hidden] { display: none !important }`** stops CSS `display` rules from accidentally showing hidden elements.
- **`:empty`** hides the notice and error boxes when they have no text, while keeping them in the DOM (live regions must exist before they change, or screen readers may miss the announcement).
- **`font-variant-numeric: tabular-nums`** keeps digits the same width so the price doesn't wobble as it updates.
- **`prefers-reduced-motion`** turns off transitions for users who ask for less motion.
- **Disabled reasons are always visible**, not hover-only tooltips, because hover doesn't exist on touch screens or for keyboard users.

### Bug found while testing
On mobile there was a big empty gap between the form and the summary. The page is a flex column with `.layout { flex: 1 }`, so the grid was taller than its content and stretched its rows to fill it. Fix: `align-content: start`.

### Tested
Screenshots at 1280px (two columns, sticky summary), 375px and 320px (one column, no horizontal scroll).

---

## Stage 3: Loading the JSON, Engine and Fuel steps

**Files:** `js/main.js`, `js/state.js`, `js/rules.js`, `js/ui.js` (+ small edits to `index.html` and `styles.css`)

### How the four modules fit together
```
user clicks a radio
   └─> main.js  (event listener)
         └─> rules.js  applySelection()   pure: returns new selections + what was reset
               └─> state.js  setSelections()   stores them, notifies subscribers
                     └─> main.js render()
                           └─> ui.js  updateChoices(), updateSteps()   touches the DOM
```
This is **one-way data flow**: the DOM never holds the truth, the state does. The UI is always redrawn *from* the state, so it can't drift out of sync. This is the same idea React and Redux are built on, done by hand.

### main.js: wiring
- `fetch("data/products.json")` inside `try/catch`. If it fails, the user gets a readable message instead of a blank page.
- **Event delegation:** one `change` listener on the `<form>` handles every radio, including ones built later. `event.target.name` says which group, `.value` which item.
- Next button: `validateStep()` first. If invalid, show the message and move focus to the first radio of the missing group.
- `checkDataIntegrity()` runs on load and prints warnings for typos in the JSON.

### state.js: a tiny store
- `selections` is a flat object: `{ engine: "nw-m500", fuel: "lng" }`. Flat on purpose, because it maps directly to a URL query string (Stage 6) and to rule conditions (`selections[rule.if.group]`).
- `getSelections()` returns a **copy**, so no other module can change state by accident.
- `subscribe(listener)` is the **observer pattern**: main.js subscribes `render`, and every change triggers a redraw.

### rules.js: pure functions
- **Pure** = same input, same output, no side effects, no DOM. That's why it could be tested in Node before the browser was involved.
- `getAvailability(data, selections)` → for every item: `{ available, reason }`. Stage 3 only uses engine → `supportedFuels`; Stage 4 adds the rules from the JSON.
- `applySelection()` = add the new choice, then `sanitizeSelections()` removes anything now invalid and **returns what it removed**, so the UI can show "Fuel "LNG" was cleared: Not supported by the NW-M250 Compact."
- Why one cleaning pass is enough: removing a choice can only *remove* restrictions, never add them.
- `sanitizeSelections()` also handles **unknown ids**, so a tampered URL or old saved config with a deleted product is cleaned instead of crashing. Stage 6 relies on this.
- `checkDataIntegrity()` finds rules or `supportedFuels` that point at ids that don't exist.

### ui.js: rendering
- **build vs update:** cards are *built* once after loading, then only *updated* (checked/disabled/reason text) on each change. If we rebuilt the HTML on every change, the focused radio would be destroyed and keyboard users would lose their place while pressing the arrow keys.
- `el()` helper uses `textContent`, never `innerHTML`, so text from the JSON or a URL can't inject HTML/scripts (**XSS prevention**).
- `Intl.NumberFormat` formats money (`€112,000`) using the currency from `meta.currency`, so no hard-coded symbols.
- Accessibility: disabled radios get `aria-describedby` pointing at their reason text. After Next/Back, focus moves to the new step's heading (`tabindex="-1"`).

### Bug found while testing
Opening `index.html` straight from disk (`file://`) left the page stuck on "Loading engines…". Browsers **block ES modules on file:// URLs**, so `main.js` never ran and couldn't report its own error. Fix: a tiny classic inline `<script>` that detects `location.protocol === "file:"` and shows instructions to use Live Server.

### Tested
- Node: availability, reset when engine changes, validation messages, unknown-id cleaning, typo detection in JSON.
- Browser (headless Edge driven by script): Next without choice shows an error and focuses the first radio; arrow keys change the choice and keep focus; M500 + LNG → back → M250 clears LNG with a notice; LNG then shows disabled with its reason; progress shows step 1 complete; no console errors; desktop and 375px layouts.

---

## Stage 4: Options step and rule engine

**Files:** `js/rules.js` (rule engine), `js/ui.js` (option groups), `js/main.js`, `css/styles.css`

### The rule engine (`applyRules` in rules.js)
After every change, `getAvailability()` starts with "everything available", then walks the `rules` list from products.json:
```
for each rule:
  is rule.if.value currently selected in rule.if.group?  no -> skip
  excludes -> disable the one item rule.then.value
  requires -> disable every OTHER item in rule.then.group
  use rule.message as the reason
```
- **No product names in the code.** "Methanol", "LNG" and "SCR" appear only in the JSON. To add a rule, a product manager adds an object to `rules`, and it works with no code change. This was tested by adding a new "NW-M1200 needs 5-year warranty" rule in a test only.
- If two rules block the same item, both reasons are kept (`disable()` joins them).
- `checkDataIntegrity()` now also reports unknown rule types (e.g. a typo like `"forbids"`).

### Why availability is recalculated from scratch every time
Instead of "when fuel changes, re-enable SCR", the whole map is rebuilt from the current selections. You never have to undo a rule; you just stop applying it. This removes a whole class of bugs where something stays disabled after the cause is gone. With ~20 items it costs microseconds.

### Auto-reset with a notice (feature 3)
Same mechanism as Stage 3, now covering rules too: `applySelection()` → `sanitizeSelections()` removes any selection the rules now block and returns it, and main.js shows it in the `aria-live` notice. Example: M500 + SCR, then go back and pick LNG → *Exhaust aftertreatment "SCR (NOx reduction)" was cleared: SCR aftertreatment is not available with LNG.*
Changing engine can clear several groups at once (fuel *and* cooling), and the notice lists them all.

### Options step (`buildOptionGroups` in ui.js)
- One `<fieldset>` + `<legend>` per option group in the JSON. A screen reader announces "Cooling, radio group". The radios in each group share `name="cooling"`, so arrow keys stay within a group.
- Weight lines (`+650 kg`) come from `weightKg`; the "+8% total weight" line comes from the `modifiers` list, so it is data-driven too.
- The same `buildChoice()` and `updateChoices()` from Stage 3 are reused. Nothing new was needed to make disabling/reasons work for options.

### Validation UX improvement
The error message sits below five groups, too far away on a phone. So groups still missing a choice get `.is-missing`: a red legend with "- required" and red card borders. Picking an option removes the highlight from that group only; the others stay highlighted until filled.

### Tested
- Node: M250 + methanol disables heat exchanger and basic control (the case traced by hand in Stage 1); methanol resets basic control; LNG resets SCR; switching to M250 resets both fuel and cooling; new JSON-only rule works; unknown rule type is reported.
- Browser: disabled options with correct reasons; Next with empty groups shows the error, highlights the right groups, focuses the first one; highlights clear one by one; reaching Summary; no console errors; mobile layout.

---

## Stage 5: Live summary and pricing

**Files:** `js/pricing.js` (new), `js/ui.js`, `js/main.js`, `index.html`, `css/styles.css`

### pricing.js: pure calculation functions
`calculateTotals(data, selections)` returns everything the screen and quote need:
```
{ lines: [{ groupLabel, label, price, weightKg }, ...],
  price, powerKw, baseWeightKg, adjustments, weightKg, co2TonnesPerYear }
```
- **Price** = engine `basePrice` + fuel `price` + each option's `price`.
- **Weight** = sum of `weightKg`, then **modifiers** from the JSON (`weightPercent: 8` → +8%). Each percentage applies to the weight *before* modifiers, so two 5% modifiers add 10%, not 10.25%. This is a business decision, written down in a comment.
- **CO2 per year** = kW × load factor × running hours × g fuel/kWh × t CO2/t fuel ÷ 1,000,000.
  Example: M500 on LNG = 500 × 0.75 × 4000 × 160 × 2.75 / 1e6 = **660 t**.
- Values that don't make sense yet return `null` (no engine → no weight, no fuel → no CO2). The UI shows "–" for `null`, which is clearer than showing 0.
- `co2GramsPerKwh(fuel)` is reused on the fuel cards ("≈ 440 g CO2 per kWh"), so customers can compare fuels before choosing.
- Rounding happens at the end, not on each step, to avoid adding up rounding errors.

**Verified by hand:** M500 + LNG + heat exchanger + advanced + no SCR + enclosure + 5y →
price 112,000 + 22,000 + 7,500 + 9,800 + 0 + 12,000 + 8,900 = **€172,200**;
weight 4,100 + 450 + 120 + 15 = 4,685, +8% (375) = **5,060 kg**. The code gave the same numbers.

### Why pricing is separate from rules
`rules.js` answers "what is *allowed*?"; `pricing.js` answers "what does it *cost/weigh*?". Different reasons to change → different files (**single responsibility principle**). Both are pure, so both are unit-testable (Stage 7).

### ui.js: live summary
- `render()` in main.js now calls `calculateTotals()` and `updateSummary()` on **every** state change, so the panel can never show stale numbers.
- **aria-live on the total price:** screen readers announce "Total price €172,200" when it changes, without the user leaving the radio they are on.
- **`setText()` only writes when the text actually changes.** Rewriting identical text in a live region can make screen readers repeat it. Tested: 7 clicks that changed the price 6 times caused exactly 6 updates.
- The weight figure shows *why* it's higher: "incl. +375 kg: Noise enclosure adds 8% to total weight" (label from the JSON).
- The CO2 assumptions note under the panel is built from `data.assumptions`, so it stays correct if the JSON changes.

### Review table (step 4)
A `<dl>` with one row per selection (group, choice, price), then power, weight, CO2 and a highlighted total. It is rebuilt on each render; that's fine here because it contains nothing focusable, so no keyboard focus can be lost.

### Possible improvement (not done)
On phones the summary panel is below the form, so you have to scroll to see the price change. A small sticky "Total: €…" bar at the bottom of the screen on mobile would fix this.

### Tested
- Node: totals for a full configuration match the hand calculation; empty and partial configs return `null` where appropriate.
- Browser: price, power, weight and CO2 update on every click; switching engine to M250 clears fuel and cooling *and* the totals drop to match (€98,700); review table correct; no console errors; desktop and mobile screenshots.

---

## Stage 6: Save/load, shareable link, export, print

**Files:** `js/state.js`, `js/main.js`, `js/ui.js`, `js/pricing.js`, `js/rules.js`, `css/print.css` (new), `index.html`, `css/styles.css`

### Save / load (localStorage), in state.js
- `saveConfiguration()` stores `{ selections, dataVersion, savedAt }` as JSON under the key `genset-configurator:v1`. The `v1` in the key means a future incompatible format can use `v2` without misreading old data.
- **Everything is wrapped in `try/catch`.** localStorage can throw when disabled, full, or blocked in private browsing, and stored text can be corrupted (`JSON.parse` throws). Saving is a convenience, so on failure we log a warning and carry on. Tested by writing `{not json` into storage: the app just starts fresh.
- `loadConfiguration()` also checks the *shape* (an object of strings), not just that it parses.
- main.js subscribes `persist()` to the state, so it saves after every change automatically. No "Save" button to forget.

### Shareable link (URL query string)
- `selectionsToQuery()` → `?engine=nw-m500&fuel=lng&...` using `URLSearchParams` (handles encoding). Groups are written in a fixed order, so the same configuration always gives the same link.
- `selectionsFromQuery()` reads only known group names and ignores everything else (e.g. `utm_source`).
- **The URL is never trusted.** Anyone can edit a link, so values go through the same `sanitizeSelections()` used for rule resets: unknown ids and invalid combinations are removed, and the notice says what was dropped. Tested with `control=<img src=x onerror=alert(1)>`: it is shown as plain text (because ui.js uses `textContent`), and nothing runs.
- `history.replaceState()` keeps the address bar in sync with the configuration on every change. `replaceState` (not `pushState`) means clicking options doesn't fill up the Back button history.
- **Priority on load:** shared link > saved configuration > empty. The app opens at the first incomplete step, or at the Summary if everything is chosen.
- "Copy shareable link" uses `navigator.clipboard.writeText()`. It only works on https/localhost and can be refused, so if it fails the link is shown in the notice to copy by hand.

### Export: Download quote
- `buildQuote()` in pricing.js is **pure**: the date and share URL are passed *in*, so tests get the same output every time. The quote contains company, date, data version, every line with price and weight, weight adjustments, totals, assumptions, the share link and the disclaimer.
- `ui.downloadFile()` puts the JSON in a `Blob`, makes a temporary `blob:` URL, clicks a hidden `<a download>`, then revokes the URL after a second to free memory (revoking immediately can cancel the download in some browsers).
- **Bug found:** the file name used `toISOString().slice(0,10)`, which is the **UTC** date. During testing at 02:39 local time (UTC+3) the file was named after the *previous* day. Fixed with `localDateStamp()` using `getFullYear/getMonth/getDate`. (The `createdAt` inside the file stays ISO/UTC on purpose; that's the standard for machine-readable timestamps.)

### Print quote (print.css)
- Linked with `media="print"`, so the browser ignores it on screen.
- Hides header, progress bar, buttons, notices and the side panel; shows only the summary step, **even if Ctrl+P is pressed on another step**. Specificity trick: `#step-summary[hidden] { display: block !important }` beats the generic `[hidden] { display: none !important }` because an id selector outranks an attribute selector.
- Forces light colours by redefining the same custom properties, so dark-mode users still get black on white. Design tokens pay off again.
- `.print-only` elements (company header, date, "Reopen this configuration online: <link>") are hidden on screen and shown on paper.
- The date is set in a `beforeprint` event, so it is correct for the button *and* for Ctrl+P.
- `break-inside: avoid` keeps table rows from splitting across pages; long URLs wrap with `word-break: break-all`.

### Start over
`confirm()` first (it's destructive), then clear storage, reset state, clean the URL, and focus step 1.

### Tested
- Node: query round trip; tampered query cleaned; quote totals; missing localStorage returns `null` instead of crashing.
- Browser: URL and storage update while choosing; reload restores and opens the right step; full link opens Summary with €172,200; tampered link cleaned and not executed; corrupted storage ignored; copy link (success and fallback); download produces correct JSON with local-date filename; print button calls print; reset clears URL and storage; print layout screenshot with dark mode on; no console errors.

---

## Stage 7: Accessibility pass, tests, README, deployment

**Files:** `tests/*.test.js`, `package.json`, `.github/workflows/deploy.yml`, `README.md`, `docs/screenshots/`, small edits to `index.html`, `js/ui.js`, `css/styles.css`

### Accessibility audit
- Ran **axe-core** (the engine behind Lighthouse's accessibility score) on every step, including error states, disabled options and notices, in **light and dark mode**: **0 violations** against WCAG 2.1 A/AA and best practices.
- Automated tools find maybe a third of real problems, so I also checked by hand:
  - **Keyboard order:** skip link → engine radio group (one Tab stop; arrow keys move inside) → Next. Correct.
  - **Skip link fix:** `<main tabindex="-1">` so focus really moves there in all browsers (otherwise some only scroll).
  - **Progress fix:** "completed" was shown only by colour. Added visually hidden text, so a screen reader says "Engine (completed)". (WCAG 1.4.1: don't use colour as the only way to convey information.)
- Design decisions worth explaining:
  - **Disabled options use real `disabled`,** so they are skipped by Tab. The trade-off: keyboard users can't focus them, but the reason is always visible text and is linked with `aria-describedby`, so screen-reader users hear it in browse mode. The alternative (`aria-disabled` + blocking clicks in JS) keeps them focusable but is more code to get right.
  - **Errors:** focus moves to the first missing group; the fieldset's `aria-describedby` points at the error text.

### Tests (Node's built-in test runner)
- `npm test` runs `node --test`, which finds every `*.test.js` file. **No dependencies**: `node:test` and `node:assert/strict` are part of Node.
- `"type": "module"` in package.json lets Node load the same ES module files the browser uses. The tests import `js/rules.js` directly; nothing is copied or mocked.
- 28 tests in four files:
  - `rules.test.js`: every rule from the spec, auto-reset, unknown ids, a JSON-only rule, validation, integrity check.
  - `pricing.test.js`: totals checked against **hand-calculated numbers** (written in the comments), the 8% modifier, CO2, null for unknowns, and a JSON-only price change.
  - `state.test.js`: subscribe/unsubscribe, copies protect state, URL round trip, stable link order, unknown params ignored.
  - `data.test.js`: tests **the data**, not the code: no broken references, unique ids, valid prices, and **every allowed engine + fuel combination can still be completed** (no dead ends). This protects the product team when they edit the JSON.
- **Testing the tests:** I changed the enclosure modifier from 8% to 10% on purpose → exactly one test failed → restored the file. A test that can't fail proves nothing.

### CI/CD with GitHub Actions
`.github/workflows/deploy.yml`:
1. **test** job: on every push/PR, check out the code, set up Node 22, run `npm test`.
2. **deploy** job: `needs: test`, so it only runs if the tests pass, and only on `main`. It uploads the folder as a Pages artifact and publishes it.
- Least privilege: the workflow gets `contents: read`; only the deploy job gets `pages: write` and `id-token: write`.
- Interview line: "A broken products.json can't reach production, because the data tests run before deployment."

### README
Written for someone seeing the project for the first time: what it is, live link, screenshots, features, architecture diagram, how to run, how to test, how it deploys. The screenshots were generated by script from the real app.

---

## TypeScript migration (separate repo: genset-configurator-ts)

The JavaScript project was copied into its own repository (with its Git history), then converted. The original repo and site were not touched.

### What changed
| Before (JS) | After (TS) |
|---|---|
| `js/*.js` | `src/*.ts`, moved with `git mv` so GitHub shows a **rename** and keeps each file's history |
| `index.html` loads `js/main.js` | loads `dist/main.js`, the compiled output (not committed; built by `npm run build` and by CI) |
| no dependencies | `typescript` and `@types/node` as **devDependencies** (needed to build, not shipped to users) |
| `tests/*.test.js` | `tests/*.test.ts`; **Node runs them directly** (built-in type stripping, Node ≥ 22.18), no compile step for tests |
| CI: test → deploy | CI: **typecheck → test → build** → deploy only `index.html`, `css`, `data`, `dist` |

### The two tsconfig files
- `tsconfig.json` checks **everything** (src + tests) and never writes files (`noEmit`). The editor and `npm run typecheck` use it.
- `tsconfig.build.json` *extends* it, compiles only `src/` to `dist/`, and adds source maps (so browser DevTools show the `.ts` lines).

### Key compiler options (be ready to explain these)
- **`strict`**: turns on `strictNullChecks` (null/undefined must be handled), `noImplicitAny`, and more.
- **`noUncheckedIndexedAccess`**: `availability["fuel"]` has type `Record<…> | undefined`, because a key can be missing. That's why the code uses `?.` and why the tests have `must()` and `statusOf()` helpers.
- **`verbatimModuleSyntax`**: types must be imported with `import type`, so the compiler can erase them without guessing.
- **`erasableSyntaxOnly`**: bans enums, namespaces and parameter properties, the TS features that generate code. Everything left can be **stripped**, which is how Node runs `.ts` tests directly.
- **`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`**: source files import `"./rules.ts"` (works in Node), and the build rewrites it to `"./rules.js"` (works in the browser).

### TypeScript techniques used (with where to find them)
- **Interfaces for JSON data** (`src/types.ts`): `Engine`, `Fuel`, `Rule`, `ProductData`, …
- **String literal unions**: `type RuleType = "excludes" | "requires"`. Assigning `"forbids"` is a compile error (see the integrity test, which has to opt out deliberately with `Object.assign`).
- **`as const` + indexed access type**: `STEPS = [...] as const` and `type StepId = (typeof STEPS)[number]`. The step names exist once, and the type follows automatically.
- **Exhaustive `switch`** in `getStepGroups`: with `noImplicitReturns`, adding a new step without handling it is a compile error.
- **Narrowing**: `"name" in item` (Engine vs Fuel/Option), `instanceof HTMLInputElement` on `event.target`, `=== null` checks.
- **`number | null`** in `Totals`: "unknown yet" is part of the type, so the UI must handle it before formatting.
- **Generics**: `byId<T extends HTMLElement>(id): T` and `el<K extends keyof HTMLElementTagNameMap>(tag: K)`. `el("input")` returns an `HTMLInputElement` automatically.
- **`unknown` + type guards** in `loadConfiguration()`: `JSON.parse` output is treated as `unknown` and checked step by step; `.filter((e): e is [string, string] => …)` is a **type predicate**.
- **`Pick<Totals, …>`** in `Quote`: reuse part of a type instead of copying it.
- **`Readonly<…>`** for test fixtures.

### What TypeScript can NOT do (important interview point)
Types exist only at compile time. `products.json` arrives through `fetch()` at runtime, and `response.json() as ProductData` is a **promise to the compiler, not a check**. So the runtime `checkDataIntegrity()` and the data tests are still needed. For full runtime validation you'd use a schema library such as Zod.

### Proof it works
- The same **28 tests** pass before and after the migration, so behaviour is unchanged.
- The same browser scripts (rules, resets, live totals, restore, share, download, print, reset) give identical results; **axe-core: 0 violations**.
- Injected two bugs on purpose to check the compiler catches them:
  - `item.basePrise` → *"Property 'basePrise' does not exist on type 'Engine'. Did you mean 'basePrice'?"*
  - removed the `engine ?` null check → *"'engine' is possibly 'undefined'."*
  In plain JS both would have run and shown `NaN` or crashed in the browser.
- Added a friendly message if `dist/` is missing ("The app hasn't been built yet. Run npm install and npm run build, then reload.").
