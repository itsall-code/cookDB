const DEFAULT_APP_WINDOW = {
  width: 1100,
  height: 760,
  type: "popup",
};

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["settings", "activeEnv"]);
  if (!data.settings) {
    const settings = {
      envs: {
        dev: {
          apiBase: "http://127.0.0.1:8642",
          sourceRedis: { host: "127.0.0.1", port: 6379, password: null, db: 0 },
          targetRedis: { host: "127.0.0.1", port: 6379, password: null, db: 1 },
          mysql: { host: "127.0.0.1", port: 3306, username: "root", password: null, database: null },
          serverConfig: { platform: "local", group: "1", server: "S1", pre_login: "local_" },
          defaultHashName: "Account",
          defaultTables: ["Account"],
          defaultDeleteKeys: []
        }
      }
    };
    await chrome.storage.local.set({ settings, activeEnv: "dev" });
  }
});

async function focusExistingAppWindow() {
  const { appWindowId } = await chrome.storage.local.get("appWindowId");
  if (!appWindowId) return false;

  try {
    await chrome.windows.update(appWindowId, { focused: true });
    return true;
  } catch {
    await chrome.storage.local.remove("appWindowId");
    return false;
  }
}

chrome.action.onClicked.addListener(async () => {
  if (await focusExistingAppWindow()) return;

  const appWindow = await chrome.windows.create({
    ...DEFAULT_APP_WINDOW,
    url: chrome.runtime.getURL("popup.html"),
  });

  if (appWindow.id) {
    await chrome.storage.local.set({ appWindowId: appWindow.id });
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { appWindowId } = await chrome.storage.local.get("appWindowId");
  if (windowId === appWindowId) {
    await chrome.storage.local.remove("appWindowId");
  }
});
