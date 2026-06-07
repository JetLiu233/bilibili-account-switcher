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

// bilibili 的深/浅色等主题偏好存在 theme_style / theme-* cookie 里。
// 切换账号时这些被当成"全局偏好"沿用,而不是跟着各账号快照走。
export function isThemeCookie(name) {
  return typeof name === "string" && name.toLowerCase().startsWith("theme");
}

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

// 仅在本地删除 bilibili 的全部 cookie。
// 关键:这不会调用 bilibili 的退出登录接口,所以服务端会话不会失效,
// 已保存的其他账号也不受影响。切换、添加新账号都复用它。
export async function clearBilibiliCookies() {
  const current = await chrome.cookies.getAll({ domain: "bilibili.com" });
  for (const c of current) {
    try {
      await chrome.cookies.remove(cookieToRemoveDetails(c));
    } catch (e) {
      // 单条失败不中断
    }
  }
}

export async function applyAccountCookies(savedCookies) {
  // 0. 记下当前的主题 cookie,切换后沿用上一次的深/浅色设置
  const current = await chrome.cookies.getAll({ domain: "bilibili.com" });
  const themeCookies = current.filter((c) => isThemeCookie(c.name));

  // 1. 本地清空当前所有 bilibili cookie,避免两个账号混在一起
  await clearBilibiliCookies();

  // 2. 写回目标账号的 cookie,统计失败数
  let failed = 0;
  for (const c of savedCookies) {
    try {
      await chrome.cookies.set(cookieToSetDetails(c));
    } catch (e) {
      failed++;
    }
  }

  // 3. 用切换前的主题 cookie 覆盖快照里的旧值,让深/浅色跨账号保持
  for (const c of themeCookies) {
    try {
      await chrome.cookies.set(cookieToSetDetails(c));
    } catch (e) {
      // 主题恢复失败不影响账号切换本身
    }
  }

  return { failed, total: savedCookies.length };
}
