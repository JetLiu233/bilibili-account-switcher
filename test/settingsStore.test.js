import { test } from "node:test";
import assert from "node:assert/strict";
import { withDefaults } from "../src/settingsStore.js";

const DEFAULTS = { autoReloadOnSwitch: true, keepFeedOnSwitch: false };

test("withDefaults 在缺省时返回默认值", () => {
  assert.deepEqual(withDefaults(undefined), DEFAULTS);
  assert.deepEqual(withDefaults(null), DEFAULTS);
  assert.deepEqual(withDefaults({}), DEFAULTS);
});

test("withDefaults 保留已有设置并覆盖默认值", () => {
  assert.deepEqual(withDefaults({ keepFeedOnSwitch: true }), {
    autoReloadOnSwitch: true,
    keepFeedOnSwitch: true,
  });
  assert.deepEqual(withDefaults({ autoReloadOnSwitch: false }), {
    autoReloadOnSwitch: false,
    keepFeedOnSwitch: false,
  });
});

test("withDefaults 合并两个键", () => {
  assert.deepEqual(
    withDefaults({ autoReloadOnSwitch: false, keepFeedOnSwitch: true }),
    { autoReloadOnSwitch: false, keepFeedOnSwitch: true }
  );
});
