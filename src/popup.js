import {
  captureCurrentCookies,
  getCurrentUid,
  applyAccountCookies,
  clearBilibiliCookies,
} from "./cookieManager.js";
import {
  loadAccounts,
  saveAccounts,
  upsertAccount,
  removeAccount,
  renameAccount,
} from "./accountStore.js";
import { fetchProfile } from "./bilibiliApi.js";
import { loadSettings, saveSettings } from "./settingsStore.js";

const listEl = document.getElementById("account-list");
const statusEl = document.getElementById("status");
const addConfirmEl = document.getElementById("add-confirm");
const autoReloadEl = document.getElementById("auto-reload");
const keepFeedEl = document.getElementById("keep-feed");
const rowKeepFeed = document.getElementById("row-keep-feed");
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");

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

const LOGIN_URL = "https://passport.bilibili.com/login";

// 打开 B 站登录页:当前标签是 bilibili 就直接导航过去,否则新开一个标签页。
// 这样即便用户当前没开 bilibili 页面,也一定能落到登录页。
async function openLoginPage() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && active.url && /:\/\/[^/]*\bbilibili\.com\//.test(active.url)) {
    await chrome.tabs.update(active.id, { url: LOGIN_URL });
  } else {
    await chrome.tabs.create({ url: LOGIN_URL });
  }
}

function renderRow(acc, currentUid) {
  const li = document.createElement("li");
  let cls = "account" + (acc.uid === currentUid ? " active" : "");
  if (editingUid === acc.uid) cls += " editing";
  else if (confirmDeleteUid === acc.uid) cls += " confirming";
  li.className = cls;

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

// 实验性:抓取当前首页前 N 个视频,失败/非首页返回 null。
async function grabActiveFeed() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !/:\/\/www\.bilibili\.com\//.test(tab.url)) return null;
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "GRAB_FEED", limit: 6 });
    return resp && Array.isArray(resp.videos) && resp.videos.length ? resp.videos : null;
  } catch (e) {
    return null; // 内容脚本未就绪 / 非首页
  }
}

async function handleSwitch(uid) {
  const accounts = await loadAccounts();
  const acc = accounts.find((a) => a.uid === uid);
  if (!acc) return;
  setStatus(`正在切换到 ${acc.name}…`);

  const settings = await loadSettings();
  const willReload = settings.autoReloadOnSwitch;
  // 仅在会刷新时才需要抓取并恢复首页视频(不刷新的话页面本就保留)
  const feedVideos =
    willReload && settings.keepFeedOnSwitch ? await grabActiveFeed() : null;

  const result = await applyAccountCookies(acc.cookies);

  if (feedVideos) {
    await chrome.storage.local.set({
      pendingFeedRestore: { videos: feedVideos, ts: Date.now() },
    });
  }

  if (willReload) await reloadBilibiliTabs();

  const base = result.failed
    ? `已切换(${result.failed}/${result.total} 条 cookie 失败)`
    : `已切换到 ${acc.name}`;
  setStatus(willReload ? base : `${base}(未刷新)`);
  await render();
}

function clearAddConfirm() {
  addConfirmEl.textContent = "";
}

// 显示行内确认条:添加新账号会本地清空登录、跳登录页,但不退出登录。
function handleAddAccount() {
  clearAddConfirm();
  const bar = document.createElement("div");
  bar.className = "confirm-bar";
  const msg = document.createElement("span");
  msg.className = "msg";
  msg.textContent =
    "将清空当前网页的登录状态并跳到登录页(不会退出登录,已保存的账号不受影响)。继续?";
  bar.appendChild(msg);
  bar.appendChild(makeBtn("继续", confirmAddAccount, "go"));
  bar.appendChild(makeBtn("取消", clearAddConfirm));
  addConfirmEl.appendChild(bar);
}

async function confirmAddAccount() {
  clearAddConfirm();
  setStatus("正在清空登录状态…");
  await clearBilibiliCookies();
  await openLoginPage();
  setStatus("已打开登录页,登录新账号后回到这里点「保存当前账号」");
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

// 保留主页推荐依赖刷新,关闭自动刷新时该开关无意义,置灰
function syncKeepFeedEnabled() {
  keepFeedEl.disabled = !autoReloadEl.checked;
  rowKeepFeed.classList.toggle("disabled", !autoReloadEl.checked);
}

async function persistSettings() {
  await saveSettings({
    autoReloadOnSwitch: autoReloadEl.checked,
    keepFeedOnSwitch: keepFeedEl.checked,
  });
}

async function initSettings() {
  const s = await loadSettings();
  autoReloadEl.checked = !!s.autoReloadOnSwitch;
  keepFeedEl.checked = !!s.keepFeedOnSwitch;
  syncKeepFeedEnabled();
}

autoReloadEl.addEventListener("change", () => {
  syncKeepFeedEnabled();
  persistSettings();
});
keepFeedEl.addEventListener("change", persistSettings);

// 齿轮:开/关设置面板,点面板外关闭
settingsToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  settingsPanel.hidden = !settingsPanel.hidden;
});
document.addEventListener("click", (e) => {
  if (
    !settingsPanel.hidden &&
    !settingsPanel.contains(e.target) &&
    e.target !== settingsToggle
  ) {
    settingsPanel.hidden = true;
  }
});

document.getElementById("save-current").addEventListener("click", handleSaveCurrent);
document.getElementById("add-account").addEventListener("click", handleAddAccount);
initSettings();
render();
