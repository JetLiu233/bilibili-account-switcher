import { test } from "node:test";
import assert from "node:assert/strict";
import { withDefaults } from "../src/settingsStore.js";

test("withDefaults 在缺省时返回默认值", () => {
  assert.deepEqual(withDefaults(undefined), { keepFeedOnSwitch: false });
  assert.deepEqual(withDefaults(null), { keepFeedOnSwitch: false });
  assert.deepEqual(withDefaults({}), { keepFeedOnSwitch: false });
});

test("withDefaults 保留已有设置并覆盖默认值", () => {
  assert.deepEqual(withDefaults({ keepFeedOnSwitch: true }), { keepFeedOnSwitch: true });
});

test("withDefaults 忽略未知键之外仍合并已知键", () => {
  const r = withDefaults({ keepFeedOnSwitch: true, extra: 1 });
  assert.equal(r.keepFeedOnSwitch, true);
});
