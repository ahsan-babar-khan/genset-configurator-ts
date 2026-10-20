# GenSet Configurator (TypeScript)

A web app for configuring a marine generator set: choose an engine, fuel and options, and see the price, weight and estimated CO2 update live. Incompatible combinations are blocked by a rule engine driven entirely by a JSON file.

Written in **strict TypeScript**, compiled to plain ES modules. No framework and no bundler; the only dependency is the TypeScript compiler.

**Live demo:** https://ahsan-babar-khan.github.io/genset-configurator-ts/

> This is the TypeScript version of my [vanilla JavaScript GenSet Configurator](https://github.com/ahsan-babar-khan/genset-configurator). The app behaves identically; the Git history shows the migration commit by commit.

> NordWave Power is a fictional company. All products, prices and CO2 figures are made up for this portfolio project.

![Options step with rule-disabled choices and the live summary panel](docs/screenshots/options-rules.png)

| Quote summary | Mobile | Dark mode |
|---|---|---|
| ![Summary step with quote table](docs/screenshots/summary.png) | ![Fuel step on a phone](docs/screenshots/mobile.png) | ![Options step in dark mode](docs/screenshots/dark-mode.png) |

## Features

- **Step-by-step form:** Engine → Fuel → Options → Summary, with a progress indicator and Back/Next.
- **Data-driven:** every engine, fuel, option, price and rule lives in [`data/products.json`](data/products.json). Changing the JSON changes the app, with no code changes.
- **Rule engine:** incompatible choices are disabled with a visible reason. If an earlier change makes a later choice invalid, it is cleared and a notice explains why.
- **Live summary:** total price, power, weight (including percentage modifiers) and estimated annual CO2, updated on every change. Sticky on desktop.
- **Validation:** you can't continue without the required choices; missing groups are highlighted.
- **Save/load:** the configuration is saved in `localStorage` automatically (with full error handling).
- **Shareable link:** the URL always contains the configuration, e.g. `?engine=nw-m500&fuel=lng&...`. Links are treated as untrusted input and sanitized.
- **Export:** download the quote as JSON, or print a clean one-page quote (dedicated print stylesheet).
- **Accessible:** semantic HTML, labelled inputs, full keyboard support, visible focus, `aria-live` price updates. Zero violations in an axe-core audit (WCAG 2.1 AA) in light and dark mode.
- **Responsive and themed:** mobile-first CSS Grid/Flexbox layout, colours as CSS custom properties, automatic dark mode.

## TypeScript setup

| Setting | Why |
|---|---|
| `strict: true` | Null checks, no implicit `any`, strict function types |
| `noUncheckedIndexedAccess` | `record[key]` is `T \| undefined`, so missing keys must be handled |
| `noImplicitReturns`, `noUnused*` | Catch dead code and forgotten branches |
| `verbatimModuleSyntax` | Type-only imports must say `import type`, so they are erased cleanly |
| `erasableSyntaxOnly` | No enums or namespaces, only syntax that can be stripped, so Node can run the `.ts` files directly |
| `rewriteRelativeImportExtensions` | Source imports use `.ts`; the compiler rewrites them to `.js` for the browser |

Highlights:
- **The data has a type.** [`src/types.ts`](src/types.ts) describes `products.json`: engines, fuels, options, rules (`type: "excludes" | "requires"`) and modifiers.
- **`null` means "not known yet."** `Totals.powerKw` is `number | null` until an engine is chosen, and the compiler forces every caller to handle that.
- **Untrusted input is `unknown`.** Data read back from `localStorage` is narrowed step by step with type guards before use.
- **Types don't validate at runtime.** `products.json` arrives through `fetch()`, so a runtime integrity check and data tests guard it as well.

## How it works

```
user clicks a radio
  └─> main.ts       event listener (wiring)
        └─> rules.ts    applySelection(): pure, returns new selections + what was reset
              └─> state.ts    stores selections, notifies subscribers
                    └─> main.ts render()
                          ├─> pricing.ts  calculateTotals(): pure
                          └─> ui.ts       updates the DOM
```

| File | Responsibility |
|---|---|
| `data/products.json` | All product data: engines, fuels, option groups, compatibility rules, weight modifiers, CO2 assumptions |
| `src/types.ts` | Types for the product data, state, rules and pricing results |
| `src/main.ts` | Loads the data and wires events, rules, state and UI together |
| `src/state.ts` | Current configuration (typed observable store), localStorage save/load, URL encode/decode |
| `src/rules.ts` | **Pure**: availability, rule engine, auto-reset, validation, data integrity check |
| `src/pricing.ts` | **Pure**: price, weight, power, CO2 totals and the quote object |
| `src/ui.ts` | All DOM rendering |
| `css/styles.css`, `css/print.css` | Screen and print styles |
| `tests/` | Unit tests (TypeScript) for rules, pricing, state and the product data |
| `dist/` | Compiled JavaScript (generated, not committed) |

### Rules as data

```json
{
  "id": "no-scr-with-lng",
  "type": "excludes",
  "if":   { "group": "fuel", "value": "lng" },
  "then": { "group": "aftertreatment", "value": "scr" },
  "message": "SCR aftertreatment is not available with LNG."
}
```

Two rule types are supported: `excludes` (disable one option) and `requires` (only one option allowed in a group). The rule engine is a single generic loop, so a new rule is a JSON edit, not a code change.

## How to run

Requires **Node.js 22.18 or newer**.

```bash
npm install        # installs the TypeScript compiler
npm run build      # compiles src/*.ts to dist/*.js
```

Then serve the folder over HTTP. In VS Code, open the folder and click **Go Live** (*Live Server* extension), or run `npx serve .`.

While developing, run `npm run dev` in a terminal. It recompiles on every save, and Live Server reloads the page.

| Script | What it does |
|---|---|
| `npm run build` | Compile `src/` to `dist/` |
| `npm run dev` | Compile on every save (watch mode) |
| `npm run typecheck` | Type-check source **and** tests without writing files |
| `npm test` | Run the 28 tests (Node runs the `.ts` files directly) |
| `npm run check` | Typecheck + test + build: everything CI does |

## Deployment

Every push runs GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)): **type-check → test → build**. On `main`, the built site (only `index.html`, `css/`, `data/` and `dist/`) is deployed to GitHub Pages, but only if every step passed.

## Git workflow

One commit per change with conventional prefixes (`feat:`, `fix:`, `refactor:`, `build:`, `test:`, `ci:`, `docs:`). The TypeScript migration commits come after the original JavaScript history; see `git log --oneline`.

## What I learned

<!-- TODO (Ahsan): rewrite this section in your own words before sharing. -->

- **Types as documentation.** `src/types.ts` makes the shape of `products.json` explicit, so a new developer can see what an engine or rule contains without reading the JSON.
- **The compiler finds bugs before users do.** A typo like `engine.basePrise`, or reading `powerKw` before an engine exists, is now a compile error instead of `NaN` on screen.
- **Types stop at the network boundary.** `fetch()` and `localStorage` return data TypeScript can't verify, so I treat it as `unknown` or keep runtime checks and data tests.
- **Migrating step by step.** Renaming with `git mv` kept each file's history, and the same 28 tests passed before and after, which showed the behaviour hadn't changed.
- **Separating data from code, pure functions and one-way data flow** (from the original JavaScript version) made the migration easy: most functions only needed type annotations.

More detailed notes are in [`docs/LEARNING-NOTES.md`](docs/LEARNING-NOTES.md).
