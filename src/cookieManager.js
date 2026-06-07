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
