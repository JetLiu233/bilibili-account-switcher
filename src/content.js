// 内容脚本(经典脚本,运行在 www.bilibili.com)。
// 职责:
//   1) 响应弹窗的 GRAB_FEED 消息 —— 读取首页前 N 个视频(链接/标题/封面)。
//   2) 页面加载时检查"待恢复"标记 —— 把保存的视频替换进首页前 N 个原生卡片。
//
// 注意:经典内容脚本不支持 ES import,所以这里是自包含的。
// 替换原生卡片依赖 B 站首页 DOM 结构,属于脆弱实现:用通用的
// a[href*="/video/BV"] 定位卡片,尽量不绑死类名;并在短时间内用
// MutationObserver 盯着 React 重渲染、被覆盖就重塞。
(function () {
  "use strict";

  const FEED_LIMIT = 6;
  const RESTORE_MAX_AGE_MS = 60 * 1000;  // 待恢复标记的有效期
  const RESTORE_WATCH_MS = 12 * 1000;    // 恢复后盯着重渲染的时长

  function parseBvId(url) {
    const m = String(url || "").match(/\/video\/(BV[0-9A-Za-z]+)/);
    return m ? m[1] : null;
  }

  function abs(u) {
    if (!u) return "";
    return u.startsWith("//") ? "https:" + u : u;
  }

  // 收集首页信息流里"卡片级"的视频:每个唯一 BV 取第一个锚点及其卡片容器。
  function collectCards(limit) {
    const result = [];
    const seen = new Set();
    const anchors = document.querySelectorAll('a[href*="/video/BV"]');
    for (const a of anchors) {
      const bv = parseBvId(a.href);
      if (!bv || seen.has(bv)) continue;
      const card =
        a.closest('.bili-video-card, [class*="video-card"], [class*="feed-card"]') ||
        a.parentElement ||
        a;
      seen.add(bv);
      result.push({ bv, anchor: a, card });
      if (result.length >= limit) break;
    }
    return result;
  }

  function titleOf(entry) {
    const { bv, anchor, card } = entry;
    const titleEl = card.querySelector(
      '.bili-video-card__info--tit, [class*="info--tit"], [class*="title"], h3'
    );
    const raw =
      anchor.getAttribute("title") ||
      (titleEl ? titleEl.textContent : "") ||
      anchor.textContent ||
      bv;
    return String(raw).trim() || bv;
  }

  function grabFeed(limit) {
    return collectCards(limit).map((e) => {
      const img = e.card.querySelector("img");
      const cover = img ? abs(img.getAttribute("src") || img.getAttribute("data-src") || "") : "";
      return { bv: e.bv, url: abs(e.anchor.href).split("?")[0], title: titleOf(e), cover };
    });
  }

  function applyVideoToCard(entry, v) {
    const { card, anchor } = entry;
    const links = card.querySelectorAll('a[href*="/video/"]');
    (links.length ? links : [anchor]).forEach((a) => {
      a.href = v.url;
      a.target = "_blank";
    });
    if (card.tagName === "A") {
      card.href = v.url;
      card.target = "_blank";
    }
    const img = card.querySelector("img");
    if (img && v.cover) {
      img.removeAttribute("srcset");
      img.src = v.cover;
    }
    const titleEl = card.querySelector(
      '.bili-video-card__info--tit, [class*="info--tit"], [class*="title"], h3'
    );
    if (titleEl && v.title) {
      titleEl.textContent = v.title;
      titleEl.setAttribute("title", v.title);
    }
    card.setAttribute("data-bas-restored", v.bv);
  }

  function restore(videos) {
    const cards = collectCards(videos.length);
    if (!cards.length) return false;
    let applied = 0;
    videos.forEach((v, i) => {
      if (cards[i]) {
        applyVideoToCard(cards[i], v);
        applied++;
      }
    });
    return applied > 0;
  }

  // 等卡片渲染出来后恢复,并在 RESTORE_WATCH_MS 内盯着 React 重渲染、被覆盖就重塞。
  function scheduleRestore(videos) {
    const deadline = Date.now() + RESTORE_WATCH_MS;
    let pending = null;
    restore(videos);
    const obs = new MutationObserver(() => {
      if (Date.now() > deadline) { obs.disconnect(); return; }
      if (pending) return;
      pending = setTimeout(() => { pending = null; restore(videos); }, 300);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), RESTORE_WATCH_MS);
  }

  // 1) 抓取请求
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "GRAB_FEED") {
      sendResponse({ videos: grabFeed(msg.limit || FEED_LIMIT) });
    }
    return false; // 同步回复
  });

  // 2) 页面加载:检查待恢复
  chrome.storage.local.get("pendingFeedRestore").then((data) => {
    const p = data.pendingFeedRestore;
    if (!p || !Array.isArray(p.videos) || !p.videos.length) return;
    chrome.storage.local.remove("pendingFeedRestore"); // 消费一次即清
    if (Date.now() - (p.ts || 0) > RESTORE_MAX_AGE_MS) return;
    scheduleRestore(p.videos);
  });
})();
