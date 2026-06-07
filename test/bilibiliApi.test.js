import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNavResponse } from "../src/bilibiliApi.js";

test("parseNavResponse 登录态返回 uid/uname/avatar", () => {
  const r = parseNavResponse({
    code: 0,
    data: { isLogin: true, mid: 123, uname: "abc", face: "http://x/y.jpg" },
  });
  assert.deepEqual(r, { uid: "123", uname: "abc", avatar: "http://x/y.jpg" });
});

test("parseNavResponse 未登录返回 null", () => {
  assert.equal(parseNavResponse({ code: 0, data: { isLogin: false } }), null);
});

test("parseNavResponse 错误码返回 null", () => {
  assert.equal(parseNavResponse({ code: -101, data: null }), null);
});

test("parseNavResponse 空响应返回 null", () => {
  assert.equal(parseNavResponse(null), null);
});
