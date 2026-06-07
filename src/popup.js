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
