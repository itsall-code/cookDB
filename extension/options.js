function byId(id) { return document.getElementById(id); }
function linesToArray(text) { return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean); }
function arrayToLines(arr) { return (arr || []).join("\n"); }

let editingMysqlConnId = null;

function getRedisConfig(prefix) {
  return {
    host: byId(`${prefix}Host`).value.trim(),
    port: Number(byId(`${prefix}Port`).value),
    password: (byId(`${prefix}Password`).value.trim() || null),
    db: Number(byId(`${prefix}Db`).value)
  };
}

function setRedisConfig(prefix, cfg = {}) {
  byId(`${prefix}Host`).value = cfg.host ?? "127.0.0.1";
  byId(`${prefix}Port`).value = cfg.port ?? 6379;
  byId(`${prefix}Password`).value = cfg.password ?? "";
  byId(`${prefix}Db`).value = cfg.db ?? 0;
}

function getMySqlConfig() {
  return {
    host: byId("mysqlHost").value.trim(),
    port: Number(byId("mysqlPort").value),
    username: byId("mysqlUsername").value.trim(),
    password: (byId("mysqlPassword").value.trim() || null),
    database: (byId("mysqlDatabase").value.trim() || null)
  };
}

function setMySqlConfig(cfg = {}) {
  byId("mysqlHost").value = cfg.host ?? "127.0.0.1";
  byId("mysqlPort").value = cfg.port ?? 3306;
  byId("mysqlUsername").value = cfg.username ?? "root";
  byId("mysqlPassword").value = cfg.password ?? "";
  byId("mysqlDatabase").value = cfg.database ?? "";
}

async function saveState(settings, activeEnv) {
  await chrome.storage.local.set({ settings, activeEnv });
}

function fillEnvSelect(envs, activeEnv) {
  const select = byId("envSelect");
  select.innerHTML = "";
  Object.keys(envs).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === activeEnv) opt.selected = true;
    select.appendChild(opt);
  });
}

function fillMysqlConnSelect(connections, activeId) {
  const select = byId("mysqlConnSelect");
  select.innerHTML = "";
  connections.forEach((conn) => {
    const opt = document.createElement("option");
    opt.value = conn.id;
    opt.textContent = conn.name;
    if (conn.id === activeId) opt.selected = true;
    select.appendChild(opt);
  });
}

function loadMysqlConnToForm(conn = {}) {
  byId("mysqlConnName").value = conn.name ?? "local";
  setMySqlConfig(conn);
}

function collectMysqlConnFromForm() {
  return {
    id: editingMysqlConnId || crypto.randomUUID(),
    name: byId("mysqlConnName").value.trim() || "local",
    ...getMySqlConfig(),
  };
}

function loadEnvToForm(env) {
  byId("apiBase").value = env.apiBase || "http://127.0.0.1:8642";
  setRedisConfig("source", env.sourceRedis);
  setRedisConfig("target", env.targetRedis);
  byId("platform").value = env.serverConfig?.platform || "local";
  byId("group").value = env.serverConfig?.group || "1";
  byId("server").value = env.serverConfig?.server || "S1";
  byId("preLogin").value = env.serverConfig?.pre_login || "local_";
  byId("defaultHashName").value = env.defaultHashName || "Account";
  byId("defaultTables").value = arrayToLines(env.defaultTables || []);
  byId("defaultDeleteKeys").value = arrayToLines(env.defaultDeleteKeys || []);
}

function collectEnvFromForm() {
  return {
    apiBase: byId("apiBase").value.trim(),
    sourceRedis: getRedisConfig("source"),
    targetRedis: getRedisConfig("target"),
    mysql: getMySqlConfig(),
    serverConfig: {
      platform: byId("platform").value.trim(),
      group: byId("group").value.trim(),
      server: byId("server").value.trim(),
      pre_login: byId("preLogin").value.trim()
    },
    defaultHashName: byId("defaultHashName").value.trim(),
    defaultTables: linesToArray(byId("defaultTables").value),
    defaultDeleteKeys: linesToArray(byId("defaultDeleteKeys").value)
  };
}

async function ensureDefaultState() {
  const loaded = await loadAppState();
  return { settings: loaded.settings, activeEnv: loaded.activeEnv };
}

async function getState() {
  return await ensureDefaultState();
}

async function refreshForm() {
  const { settings, activeEnv } = await getState();
  fillEnvSelect(settings.envs, activeEnv);
  loadEnvToForm(settings.envs[activeEnv]);

  const connections = settings.mysqlConnections || [];
  if (!editingMysqlConnId || !connections.some((c) => c.id === editingMysqlConnId)) {
    editingMysqlConnId = connections[0]?.id || null;
  }
  fillMysqlConnSelect(connections, editingMysqlConnId);
  const activeConn = connections.find((c) => c.id === editingMysqlConnId) || connections[0];
  if (activeConn) loadMysqlConnToForm(activeConn);
}

function persistMysqlConnDraft(settings, activeEnv) {
  const connections = settings.mysqlConnections || [];
  const draft = collectMysqlConnFromForm();
  const idx = connections.findIndex((c) => c.id === draft.id);
  if (idx >= 0) connections[idx] = draft;
  else connections.push(draft);
  settings.mysqlConnections = connections;
  if (settings.envs[activeEnv]) {
    settings.envs[activeEnv].mysql = getMySqlConfig();
  }
  editingMysqlConnId = draft.id;
  return settings;
}

async function saveCurrentEnv() {
  const { settings, activeEnv } = await getState();
  settings.envs[activeEnv] = collectEnvFromForm();
  persistMysqlConnDraft(settings, activeEnv);
  await saveState(settings, activeEnv);
  setStatus("设置已保存", true);
  await refreshForm();
}

function setStatus(text, ok = false, error = false) {
  const el = byId("status");
  el.textContent = text;
  el.className = "status" + (ok ? " ok" : error ? " error" : "");
}

async function testHealth() {
  const apiBase = byId("apiBase").value.trim();
  setStatus("正在检查后端...");
  try {
    const resp = await fetch(`${apiBase}/api/health`);
    const text = await resp.text();
    setStatus(`健康检查成功: ${resp.status} ${text}`, true, false);
  } catch (err) {
    setStatus(`健康检查失败: ${err.message}`, false, true);
  }
}

async function addEnv() {
  const name = byId("newEnvName").value.trim();
  if (!name) return setStatus("环境名不能为空", false, true);
  const { settings } = await getState();
  if (settings.envs[name]) return setStatus("环境已存在", false, true);
  settings.envs[name] = collectEnvFromForm();
  await saveState(settings, name);
  byId("newEnvName").value = "";
  await refreshForm();
  setStatus(`已新增环境 ${name}`, true, false);
}

async function deleteEnv() {
  const { settings, activeEnv } = await getState();
  const names = Object.keys(settings.envs);
  if (names.length <= 1) return setStatus("至少保留一个环境", false, true);
  delete settings.envs[activeEnv];
  const nextEnv = Object.keys(settings.envs)[0];
  await saveState(settings, nextEnv);
  await refreshForm();
  setStatus(`已删除环境 ${activeEnv}`, true, false);
}

async function switchEnv() {
  const envName = byId("envSelect").value;
  const { settings } = await getState();
  await saveState(settings, envName);
  loadEnvToForm(settings.envs[envName]);
  setStatus(`已切换环境 ${envName}`, true, false);
}

async function exportConfig() {
  const state = await chrome.storage.local.get(["settings", "activeEnv"]);
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cookdb-settings.json";
  a.click();
  URL.revokeObjectURL(url);
  setStatus("配置已导出", true, false);
}

function importConfig() { byId("importFile").click(); }

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data.settings || !data.activeEnv) return setStatus("导入文件格式错误", false, true);
  await chrome.storage.local.set({ settings: data.settings, activeEnv: data.activeEnv });
  await refreshForm();
  setStatus("配置已导入", true, false);
}

async function addMysqlConn() {
  const { settings, activeEnv } = await getState();
  const name = `conn-${(settings.mysqlConnections?.length || 0) + 1}`;
  const conn = {
    id: crypto.randomUUID(),
    name,
    host: "127.0.0.1",
    port: 3306,
    username: "root",
    password: null,
    database: null,
  };
  settings.mysqlConnections = [...(settings.mysqlConnections || []), conn];
  editingMysqlConnId = conn.id;
  await saveState(settings, activeEnv);
  await refreshForm();
  setStatus(`已新增连接 ${name}`, true);
}

async function deleteMysqlConn() {
  const { settings, activeEnv } = await getState();
  const connections = settings.mysqlConnections || [];
  if (connections.length <= 1) return setStatus("至少保留一个 MySQL 连接", false, true);
  settings.mysqlConnections = connections.filter((c) => c.id !== editingMysqlConnId);
  editingMysqlConnId = settings.mysqlConnections[0].id;
  await saveState(settings, activeEnv);
  await refreshForm();
  setStatus("连接已删除", true);
}

async function switchMysqlConn() {
  const { settings, activeEnv } = await getState();
  persistMysqlConnDraft(settings, activeEnv);
  editingMysqlConnId = byId("mysqlConnSelect").value;
  await saveState(settings, activeEnv);
  const conn = settings.mysqlConnections.find((c) => c.id === editingMysqlConnId);
  loadMysqlConnToForm(conn);
  setStatus(`已切换连接 ${conn?.name || ""}`, true);
}

async function testMysqlConn() {
  const { settings, activeEnv } = await getState();
  persistMysqlConnDraft(settings, activeEnv);
  await saveState(settings, activeEnv);
  const conn = collectMysqlConnFromForm();
  const apiBase = byId("apiBase").value.trim();
  setStatus("正在测试 MySQL 连接...");
  try {
    const resp = await fetch(`${apiBase.replace(/\/+$/, "")}/api/mysql/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectionToTarget(conn)),
    });
    const payload = await resp.json();
    if (!resp.ok || payload.success === false) throw new Error(payload.message || `HTTP ${resp.status}`);
    setStatus(payload.message || "MySQL 连接成功", true);
  } catch (err) {
    setStatus(`MySQL 连接失败: ${err.message}`, false, true);
  }
}

function setAppTab(tab) {
  document.querySelectorAll(".app-tabs button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.appTab === tab);
  });
  document.querySelectorAll(".app-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-app-${tab}`);
  });
}

function bindAppTabs() {
  document.querySelectorAll(".app-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => setAppTab(btn.dataset.appTab || "redis"));
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindAppTabs();
  const firstTab = await initTabOrdering(document.querySelector(".app-tabs"));
  if (firstTab) setAppTab(firstTab);
  await refreshForm();
  byId("saveBtn").addEventListener("click", saveCurrentEnv);
  byId("testHealthBtn").addEventListener("click", testHealth);
  byId("addEnvBtn").addEventListener("click", addEnv);
  byId("deleteEnvBtn").addEventListener("click", deleteEnv);
  byId("envSelect").addEventListener("change", switchEnv);
  byId("exportBtn").addEventListener("click", exportConfig);
  byId("importBtn").addEventListener("click", importConfig);
  byId("importFile").addEventListener("change", handleImportFile);
  byId("mysqlConnSelect").addEventListener("change", switchMysqlConn);
  byId("addMysqlConnBtn").addEventListener("click", addMysqlConn);
  byId("deleteMysqlConnBtn").addEventListener("click", deleteMysqlConn);
  byId("testMysqlConnBtn").addEventListener("click", testMysqlConn);
});
