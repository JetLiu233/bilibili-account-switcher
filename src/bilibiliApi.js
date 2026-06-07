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
