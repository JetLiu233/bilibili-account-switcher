# Bilibili 账号快捷切换 Chrome 扩展 — 实现计划 (TEST)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 Manifest V3 Chrome 扩展，让用户在自己的 2-3 个 bilibili 账号间一键切换（基于 `.bilibili.com` 整套 Cookie 快照的存取）。

**Architecture:** 纯弹窗驱动、无 service worker。四个单一职责模块：`accountStore`（storage 读写）、`cookieManager`（Cookie 进出 + 当前 UID）、`bilibiliApi`（nav 接口）、`popup.js`（UI 粘合）。纯逻辑（cookie 字段转换、accounts 数组操作）与 Chrome API 副作用分离，纯函数用 `node --test` 单测。

**Tech Stack:** Chrome Extension Manifest V3 · 原生 JS (ES modules) · `chrome.cookies` / `chrome.storage.local` / `chrome.tabs` · `node --test`（零依赖单元测试）

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `manifest.json` | MV3 配置：权限、弹窗入口、图标 |
| `src/popup.html` / `popup.css` | 弹窗结构与样式 |
| `src/popup.js` | UI 交互，粘合各模块 |
| `src/cookieManager.js` | 抓取/恢复 `.bilibili.com` Cookie、读当前 UID（含纯函数：快照↔`cookies.set` 参数） |
| `src/accountStore.js` | `chrome.storage.local` 中 `accounts` 的读写（含纯函数：upsert/remove/rename 数组操作） |
| `src/bilibiliApi.js` | 调 nav 接口拿昵称 + 头像 |
| `test/*.test.js` | 纯函数单元测试（`node --test`，零依赖） |

---

### Task 1: 项目脚手架与 MV3 manifest

**Files:**
- Create: `manifest.json`
- Create: `src/popup.html`
- Create: `icons/README.md`（占位说明，图标后补）
- Create: `package.json`（仅用于 `node --test`，无依赖）

- [ ] **Step 1: 创建 `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Bilibili 账号快捷切换",
  "version": "0.1.0",
  "description": "在自己的多个 bilibili 账号间一键切换",
  "permissions": ["cookies", "storage"],
  "host_permissions": ["*://*.bilibili.com/*"],
  "action": {
    "default_popup": "src/popup.html",
    "default_title": "切换 bilibili 账号"
  },
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

- [ ] **Step 2: 创建最小 `src/popup.html`（占位，后续 Task 6 填充）**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><link rel="stylesheet" href="popup.css"></head>
<body><div id="app">加载中…</div><script type="module" src="popup.js"></script></body>
</html>
```

- [ ] **Step 3: 创建 `package.json`（零依赖，仅跑测试）**

```json
{
  "name": "bilibili-account-switcher",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

- [ ] **Step 4: 验证脚手架可加载**

Run: `node --test`
Expected: PASS（0 测试通过，无报错——确认 node 与目录结构 OK）

- [ ] **Step 5: Commit**

```bash
git add manifest.json src/popup.html icons/README.md package.json
git commit -m "chore: scaffold MV3 extension and test harness"
```

---

### Task 2: `accountStore` 纯函数（accounts 数组操作，TDD）

把对 `accounts` 数组的增改删做成**纯函数**（输入数组、返回新数组），与 `chrome.storage.local` 副作用分离，便于单测。

**Files:**
- Create: `src/accountStore.js`
- Test: `test/accountStore.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/accountStore.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertAccount, removeAccount, renameAccount } from "../src/accountStore.js";

test("upsert 新增不存在的 uid", () => {
  const out = upsertAccount([], { uid: "1", uname: "a", cookies: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].uid, "1");
});

test("upsert 同 uid 覆盖且不新增条目", () => {
  const base = [{ uid: "1", name: "旧", uname: "a", cookies: [], savedAt: 1 }];
  const out = upsertAccount(base, { uid: "1", uname: "a2", cookies: [{ name: "x" }], savedAt: 2 });
  assert.equal(out.length, 1);
  assert.equal(out[0].uname, "a2");
  assert.equal(out[0].name, "旧", "用户备注名不被覆盖");
});

test("remove 按 uid 删除", () => {
  const out = removeAccount([{ uid: "1" }, { uid: "2" }], "1");
  assert.deepEqual(out.map(a => a.uid), ["2"]);
});

test("rename 只改 name", () => {
  const out = renameAccount([{ uid: "1", name: "a" }], "1", "大号");
  assert.equal(out[0].name, "大号");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/accountStore.test.js`
Expected: FAIL（`upsertAccount is not a function` / 模块未导出）

- [ ] **Step 3: 写最小实现**

```js
// src/accountStore.js
export function upsertAccount(accounts, incoming) {
  const i = accounts.findIndex(a => a.uid === incoming.uid);
  if (i === -1) {
    return [...accounts, { name: incoming.uname, ...incoming }];
  }
  const merged = { ...accounts[i], ...incoming, name: accounts[i].name };
  return accounts.map((a, idx) => (idx === i ? merged : a));
}

export function removeAccount(accounts, uid) {
  return accounts.filter(a => a.uid !== uid);
}

export function renameAccount(accounts, uid, name) {
  return accounts.map(a => (a.uid === uid ? { ...a, name } : a));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/accountStore.test.js`
Expected: PASS（4 项全过）

- [ ] **Step 5: 追加 storage 读写薄封装（副作用层，不进单测）**

```js
// src/accountStore.js (追加)
export async function loadAccounts() {
  const { accounts = [] } = await chrome.storage.local.get("accounts");
  return accounts;
}
export async function saveAccounts(accounts) {
  await chrome.storage.local.set({ accounts });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/accountStore.js test/accountStore.test.js
git commit -m "feat: accountStore pure array ops with unit tests"
```

---

### Task 3: `cookieManager` 纯函数（快照↔set 参数，TDD）

spec 第 9 节的核心单测目标：把一条 cookie 快照转成 `chrome.cookies.set` 参数，覆盖 hostOnly / secure / session / `__Secure-` 各分支；并重建删除用 url。这些是纯逻辑，可直接在 Node 跑。

**Files:**
- Create: `src/cookieManager.js`
- Test: `test/cookieManager.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/cookieManager.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cookieToSetDetails, cookieRemovalUrl } from "../src/cookieManager.js";

test("普通域 cookie → 带 domain、http url", () => {
  const d = cookieToSetDetails({ name: "DedeUserID", value: "1", domain: ".bilibili.com", path: "/", secure: false, httpOnly: false, hostOnly: false, sameSite: "lax" });
  assert.equal(d.domain, ".bilibili.com");
  assert.equal(d.url, "http://bilibili.com/");
});

test("hostOnly cookie 不带 domain 参数", () => {
  const d = cookieToSetDetails({ name: "x", value: "1", domain: "www.bilibili.com", path: "/", hostOnly: true, secure: false });
  assert.equal("domain" in d, false);
  assert.equal(d.url, "http://www.bilibili.com/");
});

test("__Secure- 前缀强制 https url", () => {
  const d = cookieToSetDetails({ name: "__Secure-foo", value: "1", domain: ".bilibili.com", path: "/", secure: true, hostOnly: false });
  assert.ok(d.url.startsWith("https://"));
});

test("session cookie 无 expirationDate → 不写过期", () => {
  const d = cookieToSetDetails({ name: "s", value: "1", domain: ".bilibili.com", path: "/", hostOnly: false });
  assert.equal("expirationDate" in d, false);
});

test("带 expirationDate 的 cookie 保留过期时间", () => {
  const d = cookieToSetDetails({ name: "SESSDATA", value: "1", domain: ".bilibili.com", path: "/", hostOnly: false, expirationDate: 1893456000 });
  assert.equal(d.expirationDate, 1893456000);
});

test("cookieRemovalUrl 与 secure cookie 的 url 一致", () => {
  assert.equal(cookieRemovalUrl({ name: "x", domain: ".bilibili.com", path: "/", secure: true, hostOnly: false }), "https://bilibili.com/");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/cookieManager.test.js`
Expected: FAIL（`cookieToSetDetails is not a function`）

- [ ] **Step 3: 写最小实现**

```js
// src/cookieManager.js
function buildUrl(cookie) {
  const secure = !!cookie.secure || cookie.name.startsWith("__Secure-") || cookie.name.startsWith("__Host-");
  const host = (cookie.domain || "").replace(/^\./, "");
  return `${secure ? "https" : "http"}://${host}${cookie.path || "/"}`;
}

export function cookieToSetDetails(cookie) {
  const details = {
    url: buildUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
    sameSite: cookie.sameSite,
  };
  if (!cookie.hostOnly) details.domain = cookie.domain;       // hostOnly 不能带 domain
  if (cookie.expirationDate != null) details.expirationDate = cookie.expirationDate; // session 则省略
  return details;
}

export function cookieRemovalUrl(cookie) {
  return buildUrl(cookie);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/cookieManager.test.js`
Expected: PASS（6 项全过）

- [ ] **Step 5: Commit**

```bash
git add src/cookieManager.js test/cookieManager.test.js
git commit -m "feat: cookieManager pure cookie<->set-details with unit tests"
```

---

### Task 4: `cookieManager` 副作用（Chrome 运行时，不进单测）

依赖 Task 3 的纯函数完成实际抓取/清除/恢复。这些调用 `chrome.*`，无法在 Node 单测，留到 Task 7 手动验收。

**Files:**
- Modify: `src/cookieManager.js`（追加副作用函数）

- [ ] **Step 1: 追加抓取与当前 UID**

```js
// src/cookieManager.js (追加)
const DOMAIN = "bilibili.com";

export async function snapshotCookies() {
  return await chrome.cookies.getAll({ domain: DOMAIN });
}

export async function getCurrentUid() {
  const c = await chrome.cookies.get({ url: "https://www.bilibili.com", name: "DedeUserID" });
  return c ? c.value : null;   // 未登录返回 null
}
```

- [ ] **Step 2: 追加清除与恢复（单条失败不中断，返回失败数）**

```js
// src/cookieManager.js (追加)
export async function clearCookies() {
  const cookies = await chrome.cookies.getAll({ domain: DOMAIN });
  for (const c of cookies) {
    await chrome.cookies.remove({ url: cookieRemovalUrl(c), name: c.name });
  }
}

export async function restoreCookies(snapshot) {
  let failed = 0;
  for (const c of snapshot) {
    try { await chrome.cookies.set(cookieToSetDetails(c)); }
    catch { failed++; }   // 单条失败不中断整体切换
  }
  return failed;          // 调用方据此汇总提示
}
```

- [ ] **Step 3: 静态校验（无运行时，仅确保语法/导出正确）**

Run: `node --check src/cookieManager.js`
Expected: 无输出、退出码 0（语法正确）

- [ ] **Step 4: Commit**

```bash
git add src/cookieManager.js
git commit -m "feat: cookieManager runtime snapshot/clear/restore"
```

---

### Task 5: `bilibiliApi` —— nav 接口取昵称/头像（解析层 TDD）

把 nav 响应解析做成纯函数单测；网络请求本身是薄封装。

**Files:**
- Create: `src/bilibiliApi.js`
- Test: `test/bilibiliApi.test.js`

- [ ] **Step 1: 写失败测试**

```js
// test/bilibiliApi.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNavData } from "../src/bilibiliApi.js";

test("已登录：提取 mid/uname/face", () => {
  const r = parseNavData({ code: 0, data: { isLogin: true, mid: 12345678, uname: "某up", face: "https://x/a.jpg" } });
  assert.deepEqual(r, { uid: "12345678", uname: "某up", avatar: "https://x/a.jpg", isLogin: true });
});

test("未登录：isLogin=false 且 uid 为 null", () => {
  const r = parseNavData({ code: -101, data: { isLogin: false } });
  assert.equal(r.isLogin, false);
  assert.equal(r.uid, null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/bilibiliApi.test.js`
Expected: FAIL（`parseNavData is not a function`）

- [ ] **Step 3: 写实现**

```js
// src/bilibiliApi.js
export function parseNavData(json) {
  const d = (json && json.data) || {};
  return {
    uid: d.mid != null ? String(d.mid) : null,
    uname: d.uname || null,
    avatar: d.face || null,
    isLogin: !!d.isLogin,
  };
}

export async function fetchNavInfo() {
  const res = await fetch("https://api.bilibili.com/x/web-interface/nav", { credentials: "include" });
  return parseNavData(await res.json());
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/bilibiliApi.test.js`
Expected: PASS（2 项全过）

- [ ] **Step 5: Commit**

```bash
git add src/bilibiliApi.js test/bilibiliApi.test.js
git commit -m "feat: bilibiliApi nav parse + fetch"
```

---

### Task 6: `popup` UI 粘合（保存/切换/重命名/删除/高亮/刷新）

把四个模块接到弹窗交互。DOM + Chrome 运行时，靠 Task 7 手动验收。

**Files:**
- Modify: `src/popup.html`
- Create: `src/popup.css`
- Create: `src/popup.js`

- [ ] **Step 1: 填充 `src/popup.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <button id="save">➕ 保存当前账号</button>
  <ul id="list"></ul>
  <p id="msg"></p>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 `src/popup.css`（最小可用样式）**

```css
body { width: 300px; font-family: system-ui, sans-serif; margin: 8px; }
#save { width: 100%; padding: 8px; margin-bottom: 8px; cursor: pointer; }
#list { list-style: none; padding: 0; margin: 0; }
.card { display: flex; align-items: center; gap: 8px; padding: 6px; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 6px; }
.card.active { border-color: #fb7299; background: #fff0f5; }
.card img { width: 32px; height: 32px; border-radius: 50%; }
.card .meta { flex: 1; font-size: 13px; }
.card button { font-size: 12px; }
#msg { color: #c00; font-size: 12px; min-height: 16px; }
```

- [ ] **Step 3: 写 `src/popup.js`（核心粘合逻辑）**

```js
// src/popup.js
import { loadAccounts, saveAccounts, upsertAccount, removeAccount, renameAccount } from "./accountStore.js";
import { snapshotCookies, getCurrentUid, clearCookies, restoreCookies } from "./cookieManager.js";
import { fetchNavInfo } from "./bilibiliApi.js";

const $list = document.getElementById("list");
const $msg = document.getElementById("msg");
const fmt = ts => new Date(ts).toLocaleString("zh-CN");
const show = t => { $msg.textContent = t || ""; };

async function reloadBiliTabs() {
  const tabs = await chrome.tabs.query({ url: "*://*.bilibili.com/*" });
  await Promise.all(tabs.map(t => chrome.tabs.reload(t.id)));
}

async function render() {
  const [accounts, currentUid] = [await loadAccounts(), await getCurrentUid()];
  $list.innerHTML = "";
  for (const a of accounts) {
    const li = document.createElement("li");
    li.className = "card" + (a.uid === currentUid ? " active" : "");
    li.innerHTML =
      `<img src="${a.avatar || ""}" alt=""><div class="meta">${a.name}<br><small>${fmt(a.savedAt)}</small></div>`;
    const sw = button("切换", () => onSwitch(a.uid));
    const rn = button("重命名", () => onRename(a.uid));
    const del = button("删除", () => onDelete(a.uid));
    li.append(sw, rn, del);
    $list.append(li);
  }
}

function button(text, fn) { const b = document.createElement("button"); b.textContent = text; b.onclick = fn; return b; }

async function onSave() {
  show("");
  const uid = await getCurrentUid();
  if (!uid) return show("请先登录再保存");
  const cookies = await snapshotCookies();
  const nav = await fetchNavInfo().catch(() => ({ uname: uid, avatar: "" }));
  const accounts = upsertAccount(await loadAccounts(), {
    uid, uname: nav.uname || uid, avatar: nav.avatar || "", cookies, savedAt: Date.now(),
  });
  await saveAccounts(accounts);
  await render();
}

async function onSwitch(uid) {
  show("");
  const acc = (await loadAccounts()).find(a => a.uid === uid);
  if (!acc) return;
  await clearCookies();
  const failed = await restoreCookies(acc.cookies);
  await reloadBiliTabs();
  if (failed) show(`已切换，但有 ${failed} 条 cookie 恢复失败`);
  await render();
}

async function onRename(uid) {
  const name = prompt("新的备注名？");
  if (!name) return;
  await saveAccounts(renameAccount(await loadAccounts(), uid, name));
  await render();
}

async function onDelete(uid) {
  if (!confirm("确认删除该账号？")) return;
  await saveAccounts(removeAccount(await loadAccounts(), uid));
  await render();
}

document.getElementById("save").onclick = onSave;
render();
```

- [ ] **Step 4: 手动冒烟（加载未打包扩展）**

操作:`chrome://extensions` → 开发者模式 → 加载已解压 → 选项目根目录 → 打开弹窗
Expected: 弹窗显示"保存当前账号"按钮与（空）列表，控制台无报错

- [ ] **Step 5: Commit**

```bash
git add src/popup.html src/popup.css src/popup.js
git commit -m "feat: popup UI wiring save/switch/rename/delete"
```

---

### Task 7: 图标占位与手动验收

**Files:**
- Create: `icons/16.png` `icons/48.png` `icons/128.png`（纯色占位）

- [ ] **Step 1: 生成占位图标**

Run: `node -e "for(const s of [16,48,128]) require('fs').writeFileSync('icons/'+s+'.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'))"`
Expected: 生成三个 1×1 png（占位，后续可换正式图标）

- [ ] **Step 2: 跑全部单测**

Run: `node --test`
Expected: PASS（accountStore 4 + cookieManager 6 + bilibiliApi 2 = 12 项）

- [ ] **Step 3: 手动验收清单（spec 第 9 节）**

- [ ] 登录账号 A → 点"保存当前账号"，卡片出现头像/昵称/时间
- [ ] 退出登录、登录账号 B → 再"保存当前账号"，出现第二张卡
- [ ] 点 A 卡"切换" → 页面刷新后变回 A，A 卡高亮
- [ ] 重命名 A → 备注名更新、再切换仍正常
- [ ] 删除 B → 列表移除
- [ ] 未登录时点保存 → 提示"请先登录再保存"

- [ ] **Step 4: Commit**

```bash
git add icons/
git commit -m "chore: placeholder icons + acceptance checklist done"
```

---

## Self-Review

- **Spec 覆盖:** 核心机制(Cookie 快照存取)=Task 3/4；数据模型=Task 2；保存/切换/高亮/删改=Task 6；权限=Task 1 manifest；nav 接口=Task 5；边界(hostOnly/secure/session/`__Secure-`/单条失败不中断)=Task 3/4 测试与实现；测试策略=各 Task 纯函数单测 + Task 7 验收。无遗漏。
- **占位符扫描:** 无 TODO/省略；每个代码步骤均给出完整代码。
- **类型一致:** `cookieToSetDetails`/`cookieRemovalUrl`/`snapshotCookies`/`getCurrentUid`/`clearCookies`/`restoreCookies`/`upsertAccount`/`removeAccount`/`renameAccount`/`parseNavData`/`fetchNavInfo` 在定义与调用处命名一致。
