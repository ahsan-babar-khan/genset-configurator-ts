import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, selectionsToQuery, selectionsFromQuery } from "../src/state.ts";
import { getAllGroups } from "../src/rules.ts";
import { loadData, FULL_CONFIG } from "./helpers.ts";

const groups = getAllGroups(loadData());

test("state notifies subscribers and returns copies", () => {
  const state = createState();
  let calls = 0;
  state.subscribe(() => calls++);

  state.setSelections({ engine: "nw-m500" });
  assert.equal(calls, 1);

  const copy = state.getSelections();
  copy.engine = "changed";
  assert.equal(state.getSelections().engine, "nw-m500"); // not mutated from outside
});

test("unsubscribe stops notifications", () => {
  const state = createState();
  let calls = 0;
  const unsubscribe = state.subscribe(() => calls++);
  unsubscribe();
  state.setStep(2);
  assert.equal(calls, 0);
});

test("configuration survives a round trip through the URL", () => {
  const query = selectionsToQuery(FULL_CONFIG, groups);
  assert.deepEqual(selectionsFromQuery(`?${query}`, groups), { ...FULL_CONFIG });
});

test("URL keys follow a fixed order, so equal configs give equal links", () => {
  const a = selectionsToQuery({ warranty: "5y", engine: "nw-m500" }, groups);
  const b = selectionsToQuery({ engine: "nw-m500", warranty: "5y" }, groups);
  assert.equal(a, b);
  assert.equal(a, "engine=nw-m500&warranty=5y");
});

test("unknown URL parameters are ignored", () => {
  const parsed = selectionsFromQuery("?engine=nw-m500&utm_source=mail&admin=1", groups);
  assert.deepEqual(parsed, { engine: "nw-m500" });
});
