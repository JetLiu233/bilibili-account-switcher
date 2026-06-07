# Bilibili 账号快捷切换 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Manifest V3 Chrome 扩展,通过快照/恢复 `.bilibili.com` 的整套 Cookie,在用户的多个 bilibili 账号间一键切换。

**Architecture:** 纯前端弹窗驱动,无后台 service worker。核心逻辑拆成纯函数(可在 Node 单元测试)与 Chrome API 包装层(手动验收)。模块:`cookieManager`(Cookie 进出)、`accountStore`(storage 读写)、`bilibiliApi`(nav 接口)、`popup.js`(粘合 UI)。

**Tech Stack:** 原生 JavaScript(ES Modules)、Chrome MV3 API(`chrome.cookies` / `chrome.storage` / `chrome.tabs`)、`node --test` 做零依赖单元测试。

> 约定:以下所有命令都在项目根目录 `bilibili-account-switcher/` 下执行。

---

## 文件结构

```
bilibili-account-switcher/
├── package.json           # type:module + test 脚本(零依赖)
├── .gitignore
├── manifest.json          # MV3 配置
├── src/
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js           # UI 交互 + 串联各模块(手动验收)
│   ├── cookieManager.js   # 纯函数 + chrome.cookies 包装
│   ├── accountStore.js    # 纯函数 + chrome.storage 包装
│   └── bilibiliApi.js     # parseNavResponse 纯函数 + fetch 包装
├── test/
│   ├── cookieManager.test.js
│   ├── accountStore.test.js
│   └── bilibiliApi.test.js
└── docs/
    ├── specs/2026-06-07-bilibili-account-switcher-design.md
    └── plans/2026-06-07-bilibili-account-switcher.md
```

职责边界:每个模块单一职责;纯函数与副作用(Chrome API)分离,前者单测,后者手动验收。

---

## Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "bilibili-account-switcher",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: 创建 .gitignore**

```
node_modules/
```

- [ ] **Step 3: 验证 test 脚本可运行(此时无测试文件)**

Run: `npm test`
Expected: 退出码 0,输出类似 `tests 0` / `pass 0`(没有测试文件不报错)。

- [ ] **Step 4: 提交**

```bash
git add package.json .gitignore
git commit -m "chore: scaffold project with node --test"
```

---

## Task 2: cookieManager 纯函数(TDD)

**Files:**
- Create: `src/cookieManager.js`
- Test: `test/cookieManager.test.js`

- [ ] **Step 1: 写失败测试**

`test/cookieManager.test.js`:

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL,报 `Cannot find module '../src/cookieManager.js'` 或导出未定义。

- [ ] **Step 3: 写最小实现**

`src/cookieManager.js`:

```js
// 持久化时从 chrome.cookies.Cookie 上保留的字段
const STORED_FIELDS = [
  "name", "value", "domain", "path",
  "secure", "httpOnly", "sameSite", "expirationDate", "hostOnly",
];

export function pickStoredFields(cookie) {
  const out = {};
  for (const f of STORED_FIELDS) {
    if (cookie[f] !== undefined) out[f] = cookie[f];
  }
  return out;
}

export function buildCookieUrl(cookie) {
  const scheme = cookie.secure ? "https" : "http";
  const host = cookie.domain.replace(/^\./, ""); // 去掉域 cookie 的前导点
  const path = cookie.path || "/";
  return `${scheme}://${host}${path}`;
}

export function cookieToRemoveDetails(cookie) {
  return { url: buildCookieUrl(cookie), name: cookie.name };
}

export function cookieToSetDetails(cookie) {
  const details = {
    url: buildCookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite || "unspecified",
  };
  // hostOnly cookie 不能带 domain,否则会被当成域 cookie
  if (!cookie.hostOnly) {
    details.domain = cookie.domain;
  }
  // session cookie 没有 expirationDate,只在存在时才设置
  if (typeof cookie.expirationDate === "number") {
    details.expirationDate = cookie.expirationDate;
  }
  return details;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS,7 个测试全过。

- [ ] **Step 5: 提交**

```bash
git add src/cookieManager.js test/cookieManager.test.js
git commit -m "feat: add cookie snapshot/restore pure helpers"
```

---

## Task 3: cookieManager Chrome 包装层

**Files:**
- Modify: `src/cookieManager.js`(在已有纯函数后追加)

> 这些函数调用 `chrome.cookies`,无法在 Node 单测,靠 Task 10 手动验收。它们只在运行时被调用,Node 导入该文件不会触发 chrome 调用,因此不影响 Task 2 的测试。

- [ ] **Step 1: 追加 Chrome 包装函数**

在 `src/cookieManager.js` 末尾追加:

```js
// ——— 以下为 Chrome API 包装层,运行时使用,手动验收 ———

export async function captureCurrentCookies() {
  const cookies = await chrome.cookies.getAll({ domain: "bilibili.com" });
  return cookies.map(pickStoredFields);
}

export async function getCurrentUid() {
  const c = await chrome.cookies.get({
    url: "https://www.bilibili.com",
    name: "DedeUserID",
  });
  return c ? c.value : null;
}

export async function applyAccountCookies(savedCookies) {
  // 1. 删除当前所有 bilibili cookie,避免两个账号混在一起
  const current = await chrome.cookies.getAll({ domain: "bilibili.com" });
  for (const c of current) {
    try {
      await chrome.cookies.remove(cookieToRemoveDetails(c));
    } catch (e) {
      // 单条失败不中断
    }
  }
  // 2. 写回目标账号的 cookie,统计失败数
  let failed = 0;
  for (const c of savedCookies) {
    try {
      await chrome.cookies.set(cookieToSetDetails(c));
    } catch (e) {
      failed++;
    }
  }
  return { failed, total: savedCookies.length };
}
```

- [ ] **Step 2: 确认纯函数测试仍通过(导入未被破坏)**

Run: `npm test`
Expected: PASS,仍为 7 个测试全过。

- [ ] **Step 3: 提交**

```bash
git add src/cookieManager.js
git commit -m "feat: add chrome.cookies capture/apply wrappers"
```

---

## Task 4: accountStore 纯函数(TDD)

**Files:**
- Create: `src/accountStore.js`
- Test: `test/accountStore.test.js`

- [ ] **Step 1: 写失败测试**

`test/accountStore.test.js`:

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL,报 `Cannot find module '../src/accountStore.js'`。

- [ ] **Step 3: 写最小实现**

`src/accountStore.js`:

```js
export function findByUid(accounts, uid) {
  return accounts.find((a) => a.uid === uid) || null;
}

export function upsertAccount(accounts, account) {
  const idx = accounts.findIndex((a) => a.uid === account.uid);
  if (idx === -1) return [...accounts, account];
  const next = accounts.slice();
  next[idx] = { ...next[idx], ...account };
  return next;
}

export function removeAccount(accounts, uid) {
  return accounts.filter((a) => a.uid !== uid);
}

export function renameAccount(accounts, uid, name) {
  return accounts.map((a) => (a.uid === uid ? { ...a, name } : a));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS,cookieManager + accountStore 共 12 个测试全过。

- [ ] **Step 5: 提交**

```bash
git add src/accountStore.js test/accountStore.test.js
git commit -m "feat: add account list pure helpers"
```

---

## Task 5: accountStore Chrome 包装层

**Files:**
- Modify: `src/accountStore.js`(追加)

- [ ] **Step 1: 追加 storage 包装函数**

在 `src/accountStore.js` 末尾追加:

```js
// ——— Chrome storage 包装层,手动验收 ———

export async function loadAccounts() {
  const data = await chrome.storage.local.get("accounts");
  return Array.isArray(data.accounts) ? data.accounts : [];
}

export async function saveAccounts(accounts) {
  await chrome.storage.local.set({ accounts });
}
```

- [ ] **Step 2: 确认测试仍通过**

Run: `npm test`
Expected: PASS,仍为 12 个测试。

- [ ] **Step 3: 提交**

```bash
git add src/accountStore.js
git commit -m "feat: add chrome.storage account persistence"
```

---

## Task 6: bilibiliApi(TDD + fetch 包装)

**Files:**
- Create: `src/bilibiliApi.js`
- Test: `test/bilibiliApi.test.js`

- [ ] **Step 1: 写失败测试**

`test/bilibiliApi.test.js`:

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL,报 `Cannot find module '../src/bilibiliApi.js'`。

- [ ] **Step 3: 写实现(纯函数 + fetch 包装)**

`src/bilibiliApi.js`:

```js
// nav 接口返回 { code: 0, data: { isLogin, mid, uname, face } }
export function parseNavResponse(json) {
  if (!json || json.code !== 0 || !json.data || !json.data.isLogin) {
    return null;
  }
  const d = json.data;
  return { uid: String(d.mid), uname: d.uname, avatar: d.face };
}

// 运行时使用,手动验收
export async function fetchProfile() {
  try {
    const res = await fetch(
      "https://api.bilibili.com/x/web-interface/nav",
      { credentials: "include" }
    );
    const json = await res.json();
    return parseNavResponse(json);
  } catch (e) {
    return null;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS,共 16 个测试全过。

- [ ] **Step 5: 提交**

```bash
git add src/bilibiliApi.js test/bilibiliApi.test.js
git commit -m "feat: add bilibili nav profile fetch"
```

---

## Task 7: manifest.json

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: 写 MV3 manifest**

`manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Bilibili 账号快捷切换",
  "version": "0.1.0",
  "description": "在多个 bilibili 账号之间一键切换",
  "permissions": ["cookies", "storage"],
  "host_permissions": ["*://*.bilibili.com/*"],
  "action": {
    "default_popup": "src/popup.html",
    "default_title": "Bilibili 账号切换"
  }
}
```

> 不声明 `tabs` 权限:切换后刷新标签页用 host 权限下的 `tabs.query`(带 url 过滤)+ `tabs.reload` 即可。图标暂不配置,Chrome 用默认拼图图标,后续可补。

- [ ] **Step 2: 提交**

```bash
git add manifest.json
git commit -m "feat: add MV3 manifest"
```

---

## Task 8: popup.html + popup.css

**Files:**
- Create: `src/popup.html`
- Create: `src/popup.css`

- [ ] **Step 1: 写 popup.html**

`src/popup.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <header>
    <button id="save-current" class="primary">➕ 保存当前账号</button>
  </header>
  <ul id="account-list"></ul>
  <div id="status"></div>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 popup.css**

`src/popup.css`:

```css
body {
  width: 320px;
  margin: 0;
  font-family: -apple-system, "Microsoft YaHei", sans-serif;
  font-size: 13px;
  background: #f6f7f8;
}
header { padding: 10px; }
button {
  cursor: pointer;
  border: 1px solid #ccd0d7;
  border-radius: 4px;
  background: #fff;
  padding: 4px 8px;
  font-size: 12px;
}
button.primary {
  width: 100%;
  background: #00aeec;
  color: #fff;
  border: none;
  padding: 8px;
  font-size: 13px;
}
button.danger { color: #e54848; }
ul { list-style: none; margin: 0; padding: 0 10px; }
li.account {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #fff;
  border: 1px solid #e3e5e7;
  border-radius: 6px;
  margin-bottom: 8px;
}
li.account.active { border-color: #00aeec; box-shadow: 0 0 0 1px #00aeec; }
li.empty { color: #999; text-align: center; padding: 16px; }
.avatar {
  width: 36px; height: 36px; border-radius: 50%;
  object-fit: cover; background: #eee; flex-shrink: 0;
}
.info { flex: 1; min-width: 0; }
.name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { color: #999; font-size: 11px; }
.actions { display: flex; flex-direction: column; gap: 4px; }
.rename-input { width: 100%; box-sizing: border-box; padding: 4px; }
#status { padding: 0 10px 10px; color: #00aeec; min-height: 16px; }
```

- [ ] **Step 3: 提交**

```bash
git add src/popup.html src/popup.css
git commit -m "feat: add popup markup and styles"
```

---

## Task 9: popup.js 编排

**Files:**
- Create: `src/popup.js`

> 不用 `alert/confirm/prompt`:原生对话框会让弹窗失焦关闭,导致结果丢失。改名/删除改为**行内交互**(行内输入框 + 行内"确认删除/取消")。用 `textContent` 写入用户名,避免 HTML 注入。

- [ ] **Step 1: 写 popup.js**

`src/popup.js`:

```js
import {
  captureCurrentCookies,
  getCurrentUid,
  applyAccountCookies,
} from "./cookieManager.js";
import {
  loadAccounts,
  saveAccounts,
  upsertAccount,
  removeAccount,
  renameAccount,
} from "./accountStore.js";
import { fetchProfile } from "./bilibiliApi.js";

const listEl = document.getElementById("account-list");
const statusEl = document.getElementById("status");

// 行内编辑状态
let editingUid = null;
let confirmDeleteUid = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function formatTime(ts) {
  return new Date(ts).toLocaleString("zh-CN");
}

function makeBtn(label, onClick, cls) {
  const b = document.createElement("button");
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

async function reloadBilibiliTabs() {
  const tabs = await chrome.tabs.query({ url: "*://*.bilibili.com/*" });
  for (const t of tabs) {
    chrome.tabs.reload(t.id);
  }
}

function renderRow(acc, currentUid) {
  const li = document.createElement("li");
  li.className = "account" + (acc.uid === currentUid ? " active" : "");

  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.src = acc.avatar || "";
  avatar.alt = "";
  li.appendChild(avatar);

  const info = document.createElement("div");
  info.className = "info";
  li.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "actions";

  if (editingUid === acc.uid) {
    const input = document.createElement("input");
    input.className = "rename-input";
    input.value = acc.name;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commitRename(acc.uid, input.value);
      if (e.key === "Escape") { editingUid = null; render(); }
    });
    info.appendChild(input);
    actions.appendChild(makeBtn("保存", () => commitRename(acc.uid, input.value)));
    actions.appendChild(makeBtn("取消", () => { editingUid = null; render(); }));
    li.appendChild(actions);
    li._focusInput = input;
    return li;
  }

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = acc.name;
  info.appendChild(name);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `UID ${acc.uid} · ${formatTime(acc.savedAt)}`;
  info.appendChild(meta);

  if (confirmDeleteUid === acc.uid) {
    actions.appendChild(makeBtn("确认删除", () => commitDelete(acc.uid), "danger"));
    actions.appendChild(makeBtn("取消", () => { confirmDeleteUid = null; render(); }));
  } else {
    actions.appendChild(makeBtn("切换", () => handleSwitch(acc.uid)));
    actions.appendChild(makeBtn("改名", () => { editingUid = acc.uid; render(); }));
    actions.appendChild(makeBtn("删除", () => { confirmDeleteUid = acc.uid; render(); }, "danger"));
  }
  li.appendChild(actions);
  return li;
}

async function render() {
  const accounts = await loadAccounts();
  const currentUid = await getCurrentUid();
  listEl.innerHTML = "";

  if (accounts.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "还没有保存账号,先登录后点上面的按钮";
    listEl.appendChild(li);
    return;
  }

  let toFocus = null;
  for (const acc of accounts) {
    const li = renderRow(acc, currentUid);
    if (li._focusInput) toFocus = li._focusInput;
    listEl.appendChild(li);
  }
  if (toFocus) toFocus.focus();
}

async function handleSaveCurrent() {
  const uid = await getCurrentUid();
  if (!uid) {
    setStatus("请先登录 bilibili 再保存");
    return;
  }
  setStatus("正在保存…");
  const cookies = await captureCurrentCookies();
  const profile = await fetchProfile();
  const accounts = await loadAccounts();
  const existing = accounts.find((a) => a.uid === uid);
  const account = {
    uid,
    name: existing ? existing.name : (profile ? profile.uname : uid),
    uname: profile ? profile.uname : (existing ? existing.uname : uid),
    avatar: profile ? profile.avatar : (existing ? existing.avatar : ""),
    cookies,
    savedAt: Date.now(),
  };
  await saveAccounts(upsertAccount(accounts, account));
  setStatus(existing ? "已刷新当前账号" : "已保存当前账号");
  await render();
}

async function handleSwitch(uid) {
  const accounts = await loadAccounts();
  const acc = accounts.find((a) => a.uid === uid);
  if (!acc) return;
  setStatus(`正在切换到 ${acc.name}…`);
  const result = await applyAccountCookies(acc.cookies);
  await reloadBilibiliTabs();
  setStatus(
    result.failed
      ? `已切换(${result.failed}/${result.total} 条 cookie 失败)`
      : `已切换到 ${acc.name}`
  );
  await render();
}

async function commitRename(uid, value) {
  const name = value.trim();
  if (name === "") {
    editingUid = null;
    return render();
  }
  const accounts = await loadAccounts();
  await saveAccounts(renameAccount(accounts, uid, name));
  editingUid = null;
  await render();
}

async function commitDelete(uid) {
  const accounts = await loadAccounts();
  await saveAccounts(removeAccount(accounts, uid));
  confirmDeleteUid = null;
  await render();
}

document.getElementById("save-current").addEventListener("click", handleSaveCurrent);
render();
```

- [ ] **Step 2: 确认单元测试不受影响**

Run: `npm test`
Expected: PASS,仍为 16 个测试(popup.js 不被 Node 测试导入)。

- [ ] **Step 3: 提交**

```bash
git add src/popup.js
git commit -m "feat: wire popup UI for save/switch/rename/delete"
```

---

## Task 10: 手动端到端验收

**Files:** 无(纯手动验证)

- [ ] **Step 1: 加载未打包扩展**

1. 打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」,选择 `bilibili-account-switcher/` 目录
4. 确认无报错加载成功,工具栏出现扩展图标

- [ ] **Step 2: 保存账号 A**

1. 在浏览器登录 bilibili 账号 A
2. 打开扩展弹窗 → 点「➕ 保存当前账号」
3. Expected:列表出现一张卡片,显示 A 的头像 + 昵称 + UID + 时间,且高亮(active 边框)

- [ ] **Step 3: 保存账号 B**

1. 在 bilibili 退出登录,改登录账号 B
2. 打开弹窗 → 点「➕ 保存当前账号」
3. Expected:列表出现两张卡片;B 高亮,A 不高亮

- [ ] **Step 4: 切换**

1. 在弹窗点 A 卡片的「切换」
2. Expected:状态显示「已切换到 …」;打开的 bilibili 标签页自动刷新后显示为账号 A 登录态;重开弹窗 A 高亮

- [ ] **Step 5: 改名**

1. 点某卡片「改名」→ 行内输入框出现并聚焦 → 改为「大号」→ 回车
2. Expected:卡片名称变为「大号」,刷新弹窗仍保留

- [ ] **Step 6: 删除**

1. 点某卡片「删除」→ 按钮变为「确认删除 / 取消」→ 点「确认删除」
2. Expected:该卡片消失;点「取消」则不删除

- [ ] **Step 7: 未登录保存提示**

1. 在 bilibili 退出登录 → 打开弹窗 → 点「保存当前账号」
2. Expected:状态显示「请先登录 bilibili 再保存」,列表不新增

- [ ] **Step 8: 刷新(过期场景手动确认)**

1. 切到任一账号后,若发现是未登录态(cookie 已过期),重新登录该账号 → 点「保存当前账号」
2. Expected:同 uid 卡片被更新(savedAt 刷新),不新增重复条目

---

## 自检(Self-Review)记录

- **Spec 覆盖**:核心机制(Task 2/3)、数据模型(Task 4/5)、保存 upsert(Task 9 handleSaveCurrent)、切换+刷新(Task 9 handleSwitch + reloadBilibiliTabs)、高亮(render + getCurrentUid)、删除/改名(Task 9)、权限(Task 7)、nav 昵称头像(Task 6)、边界(hostOnly/secure/session/失败计数 Task 2/3,未登录 Task 9)、UI(Task 8/9)、测试(Task 2/4/6 单测 + Task 10 手动)均有对应任务。
- **占位符**:无 TBD/TODO,每个代码步骤都给出完整代码。
- **类型/命名一致**:`upsertAccount/removeAccount/renameAccount/findByUid`、`captureCurrentCookies/getCurrentUid/applyAccountCookies`、`parseNavResponse/fetchProfile`、account 字段 `uid/name/uname/avatar/cookies/savedAt` 在各任务间一致;`applyAccountCookies` 返回 `{failed,total}` 与 Task 9 消费一致。
```
