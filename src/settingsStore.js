// 插件设置的存取(chrome.storage.local 的 settings 键)。

const DEFAULTS = {
  keepFeedOnSwitch: false, // 实验性:切换后把切换前的首页视频替换进新页面的前 N 个卡片
};

export function withDefaults(settings) {
  return { ...DEFAULTS, ...(settings || {}) };
}

export async function loadSettings() {
  const data = await chrome.storage.local.get("settings");
  return withDefaults(data.settings);
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings: withDefaults(settings) });
}
