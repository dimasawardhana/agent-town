import { strict as assert } from "node:assert";
import { test } from "node:test";

import { useTown } from "../src/store";

test("store subscribers receive day-control changes", () => {
  const changes: string[] = [];
  const unsubscribe = useTown.subscribe((state, previous) => {
    if (state.day !== previous.day) changes.push(state.day);
  });

  useTown.getState().setDay("day");

  unsubscribe();
  useTown.getState().setDay("dusk");
  assert.deepEqual(changes, ["day"]);
});

test("store subscribers receive direct state changes", () => {
  let notifications = 0;
  const unsubscribe = useTown.subscribe(() => {
    notifications += 1;
  });

  useTown.setState({ day: "night" });

  unsubscribe();
  useTown.setState({ day: "dusk" });
  assert.equal(notifications, 1);
});
