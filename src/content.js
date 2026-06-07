// 内容脚本(经典脚本,运行在 www.bilibili.com)。
// 职责:
//   1) 响应弹窗的 GRAB_FEED 消息 —— 读取首页前 N 个视频(链接/标题/封面)。
//   2) 页面加载时检查"待恢复"标记 —— 把保存的视频替换进首页前 N 个原生卡片。
//
// 经典内容脚本不支持 ES import,所以自包含。
// 依赖 B 站首页 DOM(2026-06 实测结构):
//   .bili-video-card               卡片容器
//     a.bili-video-card__image--link[href=".../video/BV..."]   封面链接
//     picture.bili-video-card__cover > source[srcset] + img    封面(source 优先于 img!)
//     h3.bili-video-card__info--tit[title] > a                  标题
// 关键:用精确类名做 closest,避免命中 BEM 子元素(其类名也含 "video-card")。
(function () {
  "use strict";

  const FEED_LIMIT = 6;
  const RESTORE_MAX_AGE_MS = 60 * 1000;
  const RESTORE_WATCH_MS = 12 * 1000;
  const CARD_SELECTOR = ".bili-video-card, .bili-feed-card";

  function parseBvId(url) {
    const m = String(url || "").match(/\/video\/(BV[0-9A-Za-z]+)/);
    return m ? m[1] : null;
  }

  function abs(u) {
    if (!u) return "";
    return u.startsWith("//") ? "https:" + u : u;
  }

  // 每个卡片容器取第一个视频锚点。按 BV 和卡片元素双重去重,
  // 避免同一张卡片(封面链接 + 标题链接)被收两次。
  function collectCards(limit) {
    const result = [];
    const seenBv = new Set();
    const seenCard = new Set();
    for (const a of document.querySelectorAll('a[href*="/video/BV"]')) {
      const bv = parseBvId(a.href);
      if (!bv || seenBv.has(bv)) continue;
      const card = a.closest(CARD_SELECTOR);
      if (!card || seenCard.has(card)) continue; // 跳过非卡片(如顶部轮播)/重复卡片
      seenBv.add(bv);
      seenCard.add(card);
      result.push({ bv, anchor: a, card });
      if (result.length >= limit) break;
    }
    return result;
  }

  function titleOf(card, anchor, bv) {
    const el = card.querySelector(".bili-video-card__info--tit, h3");
    const raw =
      (el && (el.getAttribute("title") || el.textContent)) ||
      anchor.getAttribute("title") ||
      anchor.textContent ||
      bv;
    return String(raw).trim() || bv;
  }

  function coverOf(card) {
    const img = card.querySelector(".bili-video-card__cover img, picture img, img");
    if (img && (img.currentSrc || img.getAttribute("src"))) {
      return abs(img.currentSrc || img.getAttribute("src"));
    }
    const src = card.querySelector(".bili-video-card__cover source[srcset], source[srcset]");
    if (src) return abs((src.getAttribute("srcset") || "").trim().split(/\s+/)[0]);
    return "";
  }

  function grabFeed(limit) {
    return collectCards(limit).map(({ bv, anchor, card }) => ({
      bv,
      url: abs(anchor.href).split("?")[0],
      title: titleOf(card, anchor, bv),
      cover: coverOf(card),
    }));
  }

  function applyVideoToCard(card, anchor, v) {
    // 链接:卡片内所有指向视频的 a 都改成我们的视频,新标签打开
    const links = card.querySelectorAll('a[href*="/video/"]');
    (links.length ? links : [anchor]).forEach((a) => {
      a.href = v.url;
      a.target = "_blank";
    });
    if (card.matches('a[href*="/video/"]')) {
      card.href = v.url;
      card.target = "_blank";
    }
    // 封面:picture 里的 source 优先于 img,必须先删 source 才会显示新图
    if (v.cover) {
      const pic = card.querySelector(".bili-video-card__cover, picture");
      if (pic) pic.querySelectorAll("source").forEach((s) => s.remove());
      const img = card.querySelector(".bili-video-card__cover img, picture img, img");
      if (img) {
        img.removeAttribute("srcset");
        img.src = v.cover;
      }
    }
    // 标题:保留内层 <a>,只改文字
    if (v.title) {
      const titleEl = card.querySelector(".bili-video-card__info--tit, h3");
      if (titleEl) {
        const link = titleEl.querySelector("a");
        if (link) link.textContent = v.title;
        else titleEl.textContent = v.title;
        titleEl.setAttribute("title", v.title);
      }
    }
    card.setAttribute("data-bas-restored", v.bv);
  }

  function restore(videos) {
    const cards = collectCards(videos.length);
    if (!cards.length) return false;
    let applied = 0;
    videos.forEach((v, i) => {
      if (cards[i]) {
        applyVideoToCard(cards[i].card, cards[i].anchor, v);
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
    return false;
  });

  // 2) 页面加载:检查待恢复(消费一次即清,过期忽略)
  chrome.storage.local.get("pendingFeedRestore").then((data) => {
    const p = data.pendingFeedRestore;
    if (!p || !Array.isArray(p.videos) || !p.videos.length) return;
    chrome.storage.local.remove("pendingFeedRestore");
    if (Date.now() - (p.ts || 0) > RESTORE_MAX_AGE_MS) return;
    scheduleRestore(p.videos);
  });
})();
