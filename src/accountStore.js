export function findByUid(accounts, uid) {
  return accounts.find((a) => a.uid === uid) || null;
}

export function upsertAccount(accounts, account) {
  const idx = accounts.findIndex((a) => a.uid === account.uid);
  if (idx === -1) return [...accounts, account];
  const next = accounts.slice();
  next[idx] = account; // 整体替换该 uid 的记录(调用方总是传完整 account)
  return next;
}

export function removeAccount(accounts, uid) {
  return accounts.filter((a) => a.uid !== uid);
}

export function renameAccount(accounts, uid, name) {
  return accounts.map((a) => (a.uid === uid ? { ...a, name } : a));
}

// ——— Chrome storage 包装层,手动验收 ———

export async function loadAccounts() {
  const data = await chrome.storage.local.get("accounts");
  return Array.isArray(data.accounts) ? data.accounts : [];
}

export async function saveAccounts(accounts) {
  await chrome.storage.local.set({ accounts });
}
