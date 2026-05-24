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
