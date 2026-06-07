import { test } from "node:test";
import assert from "node:assert/strict";
import {
  upsertAccount,
  removeAccount,
  renameAccount,
  findByUid,
} from "../src/accountStore.js";

const a = (uid, name) => ({ uid, name, cookies: [], savedAt: 0 });

test("upsertAccount 新账号追加到末尾", () => {
  const r = upsertAccount([], a("1", "x"));
  assert.equal(r.length, 1);
  assert.equal(r[0].uid, "1");
});

test("upsertAccount 同 uid 时整体替换字段", () => {
  const r = upsertAccount([a("1", "old")], {
    uid: "1", name: "new", cookies: [{ name: "c" }], savedAt: 5,
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, "new");
  assert.equal(r[0].savedAt, 5);
});

test("removeAccount 按 uid 删除", () => {
  const r = removeAccount([a("1", "x"), a("2", "y")], "1");
  assert.deepEqual(r.map((x) => x.uid), ["2"]);
});

test("renameAccount 只改匹配 uid 的 name", () => {
  const r = renameAccount([a("1", "x"), a("2", "y")], "2", "z");
  assert.equal(findByUid(r, "2").name, "z");
  assert.equal(findByUid(r, "1").name, "x");
});

test("findByUid 找不到返回 null", () => {
  assert.equal(findByUid([], "9"), null);
});
