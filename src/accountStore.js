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
