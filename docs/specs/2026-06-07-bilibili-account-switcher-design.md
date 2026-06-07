# Bilibili 账号快捷切换 Chrome 扩展 — 设计文档

- 日期:2026-06-07
- 状态:已确认,待编写实现计划

## 1. 目标与范围

一个 Chrome 扩展(Manifest V3),让用户在自己的 **2-3 个 bilibili 账号**之间一键快捷切换。

使用场景:个人在自己的电脑上,在大号/小号等属于自己的账号间切换。安全性偏向便捷。

**非目标(YAGNI):**

- 不做多人/团队共享账号、跨设备同步
- 不做主密码加密(本期明文存储,换取一键切换的便捷)
- 不做后台 service worker(所有操作均由用户点弹窗触发)
- 不支持 bilibili 之外的站点

## 2. 核心机制

bilibili 的登录态由一组作用域为 `.bilibili.com` 的 **Cookie** 维持(关键项:`SESSDATA`、`bili_jct`、`DedeUserID` 等)。因此"切换账号" = 把当前账号整套 Cookie 拍快照存下来,切换时清掉当前这套、写回目标账号那套,再刷新页面。

由于这些 Cookie 作用域是 `.bilibili.com`,抓取/恢复 `*.bilibili.com` 下的全部 Cookie 后,直播、空间、动态、漫画等子站会自动一起切换。

`chrome.cookies` 是特权扩展 API,能读写 httpOnly 的 `SESSDATA`(网页脚本的 `document.cookie` 读不到),这是本方案可行的关键。

**含义:** 扩展会把用户的登录凭证(整套 Cookie)以明文形式保存在本地 `chrome.storage.local`。这是用户已知并接受的取舍。

### 已否决的备选方案

- **多 Chrome Profile / 容器隔离**:扩展无法创建或操作 Chrome Profile;Chrome 也没有 Firefox 那种容器扩展 API。否决。
- **利用 incognito 独立 Cookie 存储**:最多两个号且需手动开隐身窗口,别扭。否决。

## 3. 架构与文件结构

纯前端弹窗驱动,无后台 service worker。

```
bilibili-account-switcher/
├── manifest.json          # MV3 配置
├── src/
│   ├── popup.html         # 弹窗结构
│   ├── popup.css          # 样式
│   ├── popup.js           # UI 交互 + 串联各模块
│   ├── cookieManager.js   # 核心:抓取/恢复 Cookie、读当前 UID
│   ├── accountStore.js    # 封装 chrome.storage.local 读写
│   └── bilibiliApi.js     # 调 nav 接口拿昵称 + 头像
├── icons/                 # 16/48/128 占位图标
├── test/
│   └── cookieManager.test.js  # 纯逻辑单元测试(node --test,零依赖)
└── docs/specs/2026-06-07-bilibili-account-switcher-design.md
```

模块边界:

- `cookieManager` — 只管 Cookie 进出与当前 UID,不碰 UI、不碰存储
- `accountStore` — 只管 `chrome.storage.local` 中 `accounts` 的读写(load / upsert / remove / rename)
- `bilibiliApi` — 只管网络请求(nav 接口)
- `popup.js` — 把上述模块粘合到 UI 交互

每个模块都能独立理解与测试。

## 4. 数据模型(`chrome.storage.local`)

```js
{
  accounts: [
    {
      uid: "12345678",       // 取自 DedeUserID cookie,作为主键
      name: "大号",           // 可编辑备注名,默认等于 uname
      uname: "某某up主",      // nav 接口返回的昵称
      avatar: "https://...",  // nav 接口返回的头像 url
      cookies: [ /* 该账号 .bilibili.com 下整套 cookie 的快照 */ ],
      savedAt: 1717000000000  // 保存时间戳(ms)
    }
  ]
}
```

每条 cookie 快照保存:`name, value, domain, path, secure, httpOnly, sameSite, expirationDate?, hostOnly` —— 这些是 `chrome.cookies.set` 重建时需要的全部字段。

## 5. 核心流程

### 5.1 保存当前账号(upsert)

1. `chrome.cookies.getAll({ domain: "bilibili.com" })` 抓取整套 cookie。
2. 从 `DedeUserID` 取得 uid;调用 nav 接口拿 uname + avatar(失败则用 uid 兜底)。
3. 若 `accounts` 中已存在同 uid 的账号 → **更新**其 cookies/uname/avatar/savedAt(顺手刷新);否则新增一条。

"保存当前账号"因此既是新增也是刷新,避免重复条目。

### 5.2 切换账号

1. 抓取并 **逐条删除** 当前所有 `.bilibili.com` cookie(防止两个号的 cookie 混在一起)。
2. 把目标账号快照里的每条 cookie 用 `chrome.cookies.set` 写回。
3. 刷新所有打开着的 bilibili 标签页:`chrome.tabs.query({ url: "*://*.bilibili.com/*" })` + `chrome.tabs.reload`(靠 host 权限即可,无需额外 `tabs` 权限)。

### 5.3 当前在线账号高亮

读取 `DedeUserID` cookie,匹配 `accounts` 中的 uid,高亮对应卡片。

### 5.4 删除 / 重命名

直接修改 `accounts` 数组并写回 storage。重命名只改 `name` 字段。

## 6. 权限(manifest)

```jsonc
{
  "permissions": ["cookies", "storage"],
  "host_permissions": ["*://*.bilibili.com/*"]  // 含 api.bilibili.com
}
```

切换后刷新标签页通过 host 权限下的 `tabs.query`(带 url 过滤)+ `tabs.reload` 实现,无需声明 `tabs` 权限。

nav 接口调用:从弹窗(扩展页面)`fetch("https://api.bilibili.com/x/web-interface/nav", { credentials: "include" })`,host 权限会让 `.bilibili.com` 的 cookie 随请求带上,返回 `data.uname` / `data.face` / `data.mid`。

## 7. 边界情况与错误处理

- **httpOnly / Secure / `__Secure-` 前缀 cookie**:重建时正确还原 secure 标志与 url;逐条 `set`,**单条失败不中断**整体切换,最后汇总提示失败数量。
- **hostOnly cookie**:`hostOnly:true` 时 `cookies.set` 不能带 `domain` 参数(否则变成域 cookie);按标志区分处理。
- **session cookie**(无 expirationDate):不设过期时间,保持会话 cookie。
- **cookie 过期**:`SESSDATA` 约数月过期;切到过期快照会变成未登录态——cookie 机制的固有限制,无法绕过。缓解:卡片显示 `savedAt`,随时"保存当前账号"刷新。
- **当前未登录就点保存**:检测不到 `DedeUserID` → 提示"请先登录再保存"。

## 8. UI / UX

- 弹窗顶部:`➕ 保存当前账号` 按钮。
- 下方:账号卡片列表,每张卡显示头像 + 昵称(name)+ savedAt;当前在线账号高亮。
- 每张卡操作:切换 / 重命名 / 删除。
- 切换后自动刷新所有打开的 bilibili 标签页。
- 界面文案为中文。

## 9. 测试策略

- **单元测试(零依赖,`node --test`)**:针对 `cookieManager` 中的**纯函数**——
  - 把一条 cookie 快照转换为 `chrome.cookies.set` 参数(覆盖 hostOnly / secure / session / `__Secure-` 各分支)
  - 重建用于删除的 url
  这些不依赖 Chrome 运行时,可直接在 Node 跑。
- **手动验收清单**:加载未打包扩展 → 登录 A 保存 → 换 B 保存 → 切换验证(头像/高亮/页面刷新)→ 删除 → 重命名 → 过期提示。

## 10. 设计原则记录

- 模块按单一职责拆分,接口清晰,可独立测试。
- 纯逻辑(cookie 转换)与副作用(Chrome API 调用)分离,便于单元测试。
- 明文存储是已知取舍,换取一键切换的便捷;未来如需加密可在 `accountStore` 这一层加,不影响其他模块。

## 11. 服务端会话与"添加新账号"流程(2026-06-07 实测补充)

**踩坑根因**:`SESSDATA` 是服务端会话令牌。点 bilibili 的"退出登录"会调用注销接口,在**服务端**作废该令牌。此后即便本地把整套 Cookie 完整恢复,B 站仍判定未登录(本地 Cookie 完好 ≠ 服务端认)。仅本地清空/覆盖 Cookie 不会惊动服务端(因此同一账号能在多设备并存)。

**结论**:多账号管理必须全程绕开"退出登录",所有"清空登录态"的动作都只在本地用 `chrome.cookies.remove` 完成。

**设计调整**:

- 从 `applyAccountCookies` 抽出 `clearBilibiliCookies()`:只本地删除 `.bilibili.com` 全部 Cookie,绝不调用退出登录接口。切换与添加新账号共用它。
- 新增「➕ 添加新账号(去登录页)」入口:行内确认 → `clearBilibiliCookies()` → **主动打开** B 站登录页 `https://passport.bilibili.com/login`(当前标签是 bilibili 则导航该标签,否则新开标签;不依赖用户已开着 bilibili 页面)→ 用户登录新号 → 「保存当前账号」(同 UID 走 upsert 覆盖)。其它已保存账号的服务端会话不受影响。
- 界面常驻警告 + README 说明:不要点 B 站的"退出登录"。

**不可恢复性**:一旦某账号已被"退出登录"作废,本地无法复活,只能经"添加新账号"流程重新登录、重新保存。

## 12. 主题(深/浅色)跨账号保持(2026-06-07)

bilibili 的深/浅色偏好存在 `theme_style`(及 `theme-*` 提示标记)cookie 里。原始切换逻辑会清空全部 cookie 再写回目标账号快照,导致主题被快照里的旧值覆盖(常表现为每次切换都回到浅色)。

**调整**:把主题当成全局偏好——`applyAccountCookies` 在清空前先抓取当前 `theme*` cookie(`isThemeCookie()` 判定),写回目标账号后再用它们覆盖,使深/浅色设置跨账号沿用,不跟随各账号快照。`isThemeCookie` 为纯函数,有单元测试。

**已知边界**:此修复假设主题由 cookie 驱动(与实测 cookie dump 一致)。若 bilibili 某些场景改用 localStorage 存主题,则需改用 content script 方案;目前未发现该需求。

## 13. 实验性:切换后保留首页视频(2026-06-07)

**需求**:在首页看到想看的视频,切换账号后页面刷新、视频流变成另一批,原视频丢失。希望切换后仍能在页面上看到切换前的那几个视频,并用新账号打开。

**取舍**:首页推荐每次加载随机,无法"穿过刷新"保留原始信息流。用户选择"替换 B 站原生的前 N 个卡片"这一最直观但最脆弱的呈现方式(已知会被 React 重渲染清掉、改版即失效)。

**架构**(不新增 `scripting` 权限,改用内容脚本):

- 新增内容脚本 `src/content.js`,`content_scripts` 匹配 `*://www.bilibili.com/*`,`run_at: document_idle`。经典脚本、自包含(内容脚本不支持 ES import)。
- 抓取:弹窗 `handleSwitch` 在切换前,若开关开启且当前是 www.bilibili.com,向该标签的内容脚本发 `GRAB_FEED` 消息,读取前 N 个(N=6)视频的链接/标题/封面。用通用选择器 `a[href*="/video/BV"]` 定位,尽量不绑死类名。
- 传递:切换 cookie 后把 `{videos, ts}` 写入 `chrome.storage.local.pendingFeedRestore`,然后刷新。
- 恢复:刷新后内容脚本读取该标记(消费一次即清,>60s 视为过期),等卡片渲染出来,把保存的视频替换进前 N 个原生卡片(改 `href`/`target`/封面 `img`/标题),并在 12s 内用 MutationObserver 盯着 React 重渲染、被覆盖就重塞。
- 开关:`settingsStore.js` 管理 `settings.keepFeedOnSwitch`,**默认关**(实验性、且会改写页面 DOM)。`withDefaults` 为纯函数,有单元测试。

**已知脆弱点**:抓取与替换都依赖 B 站首页 DOM;B 站改版可能失效。替换后的卡片上播放量/时长等数字仍是原卡片的(只换了链接/标题/封面)。这些是该呈现方式的固有代价。
