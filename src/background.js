// 后台 service worker。
// 扩展安装/更新/浏览器启动时,把内容脚本注入到已经打开的 B 站标签页。
// 否则刚重新加载扩展后,旧标签页里没有内容脚本,第一次切换抓不到首页视频。
async function reinjectOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: "*://www.bilibili.com/*" });
    for (const t of tabs) {
      chrome.scripting
        .executeScript({ target: { tabId: t.id }, files: ["src/content.js"] })
        .catch(() => {}); // 个别标签(如未完全加载)失败不影响其它
    }
  } catch (e) {
    // 忽略
  }
}

chrome.runtime.onInstalled.addListener(reinjectOpenTabs);
chrome.runtime.onStartup.addListener(reinjectOpenTabs);
