import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCookieUrl,
  cookieToSetDetails,
  cookieToRemoveDetails,
  pickStoredFields,
} from "../src/cookieManager.js";

test("buildCookieUrl 对 secure cookie 用 https 并去掉前导点", () => {
  assert.equal(
    buildCookieUrl({ domain: ".bilibili.com", path: "/", secure: true }),
    "https://bilibili.com/"
  );
});

test("buildCookieUrl 对非 secure cookie 用 http", () => {
  assert.equal(
    buildCookieUrl({ domain: "www.bilibili.com", path: "/x", secure: false }),
    "http://www.bilibili.com/x"
  );
});

test("cookieToSetDetails 对 hostOnly cookie 不带 domain", () => {
  const d = cookieToSetDetails({
    name: "a", value: "1", domain: "www.bilibili.com", path: "/",
    secure: true, hostOnly: true, sameSite: "lax",
  });
  assert.equal(d.domain, undefined);
  assert.equal(d.url, "https://www.bilibili.com/");
});

test("cookieToSetDetails 对域 cookie 保留 domain 和 expirationDate", () => {
  const d = cookieToSetDetails({
    name: "SESSDATA", value: "x", domain: ".bilibili.com", path: "/",
    secure: true, httpOnly: true, hostOnly: false,
    sameSite: "no_restriction", expirationDate: 123,
  });
  assert.equal(d.domain, ".bilibili.com");
  assert.equal(d.expirationDate, 123);
  assert.equal(d.httpOnly, true);
});

test("cookieToSetDetails 对 session cookie 不带 expirationDate,sameSite 兜底", () => {
  const d = cookieToSetDetails({
    name: "s", value: "1", domain: ".bilibili.com", path: "/",
    secure: false, hostOnly: false,
  });
  assert.equal("expirationDate" in d, false);
  assert.equal(d.sameSite, "unspecified");
});

test("cookieToRemoveDetails 返回 url 和 name", () => {
  const r = cookieToRemoveDetails({
    name: "DedeUserID", domain: ".bilibili.com", path: "/", secure: true,
  });
  assert.deepEqual(r, { url: "https://bilibili.com/", name: "DedeUserID" });
});

test("pickStoredFields 只保留已知字段", () => {
  const c = pickStoredFields({
    name: "a", value: "b", domain: ".x", path: "/", secure: true,
    httpOnly: false, sameSite: "lax", expirationDate: 1, hostOnly: false,
    session: false, storeId: "0",
  });
  assert.deepEqual(
    Object.keys(c).sort(),
    ["domain","expirationDate","hostOnly","httpOnly","name","path","sameSite","secure","value"]
  );
});
