const DEFAULT_TIMEOUT = 60_000;
const LONG_TIMEOUT = 300_000;
const IMPORT_POLL_INTERVAL = 800;

const DEFAULT_MYSQL_CONNECTIONS = [
  { id: "local", name: "local", host: "127.0.0.1", port: 3306, username: "root", password: null, database: null },
  { id: "dev", name: "dev", host: "127.0.0.1", port: 3306, username: "root", password: null, database: "game" },
  { id: "test", name: "test", host: "127.0.0.1", port: 3306, username: "root", password: null, database: "game_test" },
  { id: "staging", name: "staging", host: "127.0.0.1", port: 3306, username: "root", password: null, database: "game_staging" },
];

function defaultEnv() {
  return {
    apiBase: "http://127.0.0.1:8642",
    sourceRedis: { host: "127.0.0.1", port: 6379, password: null, db: 0 },
    targetRedis: { host: "127.0.0.1", port: 6379, password: null, db: 1 },
    mysql: { host: "127.0.0.1", port: 3306, username: "root", password: null, database: null },
    serverConfig: { platform: "local", group: "1", server: "S1", pre_login: "local_" },
    defaultHashName: "Account",
    defaultTables: ["Account"],
    defaultDeleteKeys: [],
  };
}

function normalizeApiBase(apiBase) {
  return String(apiBase || "http://127.0.0.1:8642").replace(/\/+$/, "");
}

async function loadAppState() {
  const data = await chrome.storage.local.get(["settings", "activeEnv", "sqlHistory", "mysqlActiveConnectionId"]);
  let settings = data.settings;
  let activeEnv = data.activeEnv;

  if (!settings?.envs || Object.keys(settings.envs).length === 0) {
    settings = { envs: { dev: defaultEnv() }, mysqlConnections: DEFAULT_MYSQL_CONNECTIONS.map((c) => ({ ...c })) };
    activeEnv = "dev";
    await chrome.storage.local.set({ settings, activeEnv });
  } else if (!settings.mysqlConnections?.length) {
    settings.mysqlConnections = DEFAULT_MYSQL_CONNECTIONS.map((c) => ({ ...c }));
    await chrome.storage.local.set({ settings });
  }

  if (!activeEnv || !settings.envs[activeEnv]) {
    activeEnv = Object.keys(settings.envs)[0];
    await chrome.storage.local.set({ activeEnv });
  }

  const rawHistory = data.sqlHistory || [];
  const sqlHistory = trimSqlHistory(rawHistory);
  if (JSON.stringify(sqlHistory) !== JSON.stringify(rawHistory)) {
    await chrome.storage.local.set({ sqlHistory });
  }

  return {
    settings,
    activeEnv,
    sqlHistory,
    mysqlActiveConnectionId: data.mysqlActiveConnectionId || settings.mysqlConnections[0]?.id || "local",
  };
}

function getActiveEnv(state) {
  return state.settings.envs[state.activeEnv] || defaultEnv();
}

function apiUrl(state, path) {
  return `${normalizeApiBase(getActiveEnv(state).apiBase)}${path}`;
}

async function apiFetch(state, path, options = {}, timeout = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(apiUrl(state, path), {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok || payload.success === false) {
      throw new Error(payload.message || `HTTP ${resp.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function connectionToTarget(conn) {
  return {
    host: conn.host,
    port: Number(conn.port),
    username: conn.username,
    password: conn.password || null,
    database: conn.database || null,
  };
}

function executeConfirmText(conn, dangerous = false) {
  const db = conn.database || "";
  if (dangerous) return `DANGEROUS EXECUTE mysql ${conn.host} db=${db}`;
  return `EXECUTE mysql ${conn.host} db=${db}`;
}

function importConfirmText(conn, filePath) {
  const db = conn.database || "";
  const fileName = String(filePath).split(/[/\\]/).pop() || filePath;
  return `IMPORT mysql ${conn.host} db=${db} file=${fileName}`;
}

function flushDbConfirmText(conn) {
  const db = conn.database || "";
  return `FLUSH mysql ${conn.host} db=${db}`;
}

function isDangerousSql(sql) {
  return String(sql || "")
    .split(";")
    .some((statement) => {
      const trimmed = statement.trim().toLowerCase();
      return ["delete", "truncate", "drop"].some((p) => trimmed.startsWith(p));
    });
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatDuration(ms) {
  if (!ms) return "0s";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function uuid() {
  return crypto.randomUUID();
}

function normalizeSqlForHistory(sql) {
  return String(sql || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sqlHistoryKey(entry) {
  return `${entry.type || "query"}|${entry.connectionName || ""}|${normalizeSqlForHistory(entry.sql)}`;
}

function dedupeSqlHistoryList(history) {
  const byKey = new Map();
  const sorted = [...history].sort((a, b) => (b.executedAt || 0) - (a.executedAt || 0));
  for (const item of sorted) {
    const key = sqlHistoryKey(item);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...item, runCount: item.runCount || 1 });
      continue;
    }
    byKey.set(key, {
      ...item,
      id: item.id,
      favorite: prev.favorite || item.favorite,
      runCount: (prev.runCount || 1) + (item.runCount || 1),
      durationMs: item.durationMs ?? prev.durationMs,
      rowCount: item.rowCount ?? prev.rowCount,
    });
  }
  return [...byKey.values()].sort((a, b) => (b.executedAt || 0) - (a.executedAt || 0));
}

function trimSqlHistory(history) {
  const deduped = dedupeSqlHistoryList(history);
  const favorites = deduped.filter((h) => h.favorite);
  const nonFavorites = deduped.filter((h) => !h.favorite);
  while (nonFavorites.length > 1000) nonFavorites.pop();
  return [...favorites, ...nonFavorites].sort((a, b) => (b.executedAt || 0) - (a.executedAt || 0));
}

async function pushSqlHistory(entry) {
  const data = await chrome.storage.local.get(["sqlHistory"]);
  const history = data.sqlHistory || [];
  const key = sqlHistoryKey(entry);
  const existingIdx = history.findIndex((h) => sqlHistoryKey(h) === key);
  const now = Date.now();

  if (existingIdx >= 0) {
    const existing = history[existingIdx];
    history.splice(existingIdx, 1);
    history.unshift({
      ...existing,
      ...entry,
      id: existing.id,
      favorite: existing.favorite,
      executedAt: now,
      runCount: (existing.runCount || 1) + 1,
    });
  } else {
    history.unshift({
      id: uuid(),
      favorite: false,
      executedAt: now,
      runCount: 1,
      ...entry,
    });
  }

  const merged = trimSqlHistory(history);
  await chrome.storage.local.set({ sqlHistory: merged });
  return merged;
}

async function toggleSqlFavorite(id) {
  const data = await chrome.storage.local.get(["sqlHistory"]);
  const history = (data.sqlHistory || []).map((item) =>
    item.id === id ? { ...item, favorite: !item.favorite } : item
  );
  await chrome.storage.local.set({ sqlHistory: history });
  return history;
}

async function deleteSqlHistory(id) {
  const data = await chrome.storage.local.get(["sqlHistory"]);
  const history = (data.sqlHistory || []).filter((item) => item.id !== id);
  await chrome.storage.local.set({ sqlHistory: history });
  return history;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const APP_TAB_ORDER_KEY = "appTabOrder";
const MYSQL_LOOKUP_CACHE_KEY = "mysqlLookupCache";
const MYSQL_BATCH_IMPORT_MAPPING_KEY = "mysqlBatchImportMapping";
const MYSQL_BATCH_IMPORT_HISTORY_KEY = "mysqlBatchImportHistory";
const MYSQL_BATCH_FLUSH_CONFIG_KEY = "mysqlBatchFlushConfig";
const MYSQL_BATCH_FLUSH_HISTORY_KEY = "mysqlBatchFlushHistory";
const BATCH_IMPORT_HISTORY_LIMIT = 50;
const BATCH_FLUSH_HISTORY_LIMIT = 50;

async function loadMysqlLookupCache(connectionId) {
  if (!connectionId) return null;
  const data = await chrome.storage.local.get([MYSQL_LOOKUP_CACHE_KEY]);
  const cache = data[MYSQL_LOOKUP_CACHE_KEY] || {};
  const entry = cache[connectionId];
  if (!entry?.table) return null;
  return {
    table: entry.table,
    keyColumn: entry.keyColumn || entry.key_column || "",
    valueColumn: entry.valueColumn || entry.value_column || "",
  };
}

function normalizeBatchImportUi(rawUi) {
  const ui = rawUi && typeof rawUi === "object" ? rawUi : {};
  const pick = (key, legacy) =>
    ui[key] !== undefined ? Boolean(ui[key]) : ui[legacy] !== undefined ? Boolean(ui[legacy]) : true;
  return {
    composeCollapsed: pick("composeCollapsed", "branchCollapsed"),
    historyCollapsed: pick("historyCollapsed", "sqlCollapsed"),
  };
}

function normalizeMysqlBatchImportConfig(raw) {
  if (!raw || typeof raw !== "object") {
    return { enabled: [], files: {}, ui: normalizeBatchImportUi(null) };
  }
  if (Array.isArray(raw.enabled) && raw.files && typeof raw.files === "object") {
    return {
      enabled: raw.enabled.filter((id) => typeof id === "string"),
      files: { ...raw.files },
      ui: normalizeBatchImportUi(raw.ui),
    };
  }
  const files = {};
  const enabled = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key === "ui") continue;
    if (typeof value === "string" && value) {
      files[key] = value;
      enabled.push(key);
    }
  }
  return { enabled, files, ui: normalizeBatchImportUi(raw.ui) };
}

async function loadMysqlBatchImportConfig() {
  const data = await chrome.storage.local.get([MYSQL_BATCH_IMPORT_MAPPING_KEY]);
  return normalizeMysqlBatchImportConfig(data[MYSQL_BATCH_IMPORT_MAPPING_KEY]);
}

async function saveMysqlBatchImportConfig(config) {
  const normalized = normalizeMysqlBatchImportConfig(config);
  await chrome.storage.local.set({ [MYSQL_BATCH_IMPORT_MAPPING_KEY]: normalized });
  return normalized;
}

function batchImportMappingKey(enabled, files) {
  return (enabled || [])
    .filter((id) => files?.[id])
    .sort()
    .map((id) => `${id}::${files[id]}`)
    .join("|");
}

function buildBatchImportSummary(enabled, files, connectionsById = {}) {
  const parts = (enabled || [])
    .filter((id) => files?.[id])
    .map((id) => {
      const name = connectionsById[id]?.name || id;
      const fileName = String(files[id]).split(/[/\\]/).pop() || files[id];
      return `${name} → ${fileName}`;
    });
  return parts.join(" · ");
}

function normalizeBatchImportHistoryEntry(raw, connectionsById = {}) {
  if (!raw || typeof raw !== "object") return null;
  const enabled = Array.isArray(raw.enabled) ? raw.enabled.filter((id) => typeof id === "string") : [];
  const files =
    raw.files && typeof raw.files === "object"
      ? Object.fromEntries(Object.entries(raw.files).filter(([, path]) => typeof path === "string" && path))
      : {};
  const validEnabled = enabled.filter((id) => files[id]);
  if (!validEnabled.length) return null;
  return {
    id: typeof raw.id === "string" ? raw.id : uuid(),
    savedAt: Number(raw.savedAt) || Date.now(),
    enabled: validEnabled,
    files: { ...files },
    summary: raw.summary || buildBatchImportSummary(validEnabled, files, connectionsById),
  };
}

async function loadMysqlBatchImportHistory() {
  const data = await chrome.storage.local.get([MYSQL_BATCH_IMPORT_HISTORY_KEY]);
  const list = Array.isArray(data[MYSQL_BATCH_IMPORT_HISTORY_KEY]) ? data[MYSQL_BATCH_IMPORT_HISTORY_KEY] : [];
  return list
    .map((item) => normalizeBatchImportHistoryEntry(item))
    .filter(Boolean);
}

async function upsertMysqlBatchImportHistory(preset, connectionsById = {}) {
  const enabled = (preset.enabled || []).filter((id) => preset.files?.[id]);
  if (!enabled.length) return loadMysqlBatchImportHistory();

  const key = batchImportMappingKey(enabled, preset.files);
  const history = await loadMysqlBatchImportHistory();
  const summary = buildBatchImportSummary(enabled, preset.files, connectionsById);
  const existingIdx = history.findIndex((item) => batchImportMappingKey(item.enabled, item.files) === key);
  const entry = {
    id: existingIdx >= 0 ? history[existingIdx].id : uuid(),
    savedAt: Date.now(),
    enabled: [...enabled],
    files: { ...preset.files },
    summary,
  };

  if (existingIdx >= 0) history.splice(existingIdx, 1);
  history.unshift(entry);
  while (history.length > BATCH_IMPORT_HISTORY_LIMIT) history.pop();
  await chrome.storage.local.set({ [MYSQL_BATCH_IMPORT_HISTORY_KEY]: history });
  return history;
}

async function deleteMysqlBatchImportHistoryEntry(id) {
  const history = await loadMysqlBatchImportHistory();
  const next = history.filter((item) => item.id !== id);
  await chrome.storage.local.set({ [MYSQL_BATCH_IMPORT_HISTORY_KEY]: next });
  return next;
}

function normalizeMysqlBatchFlushConfig(raw) {
  if (!raw || typeof raw !== "object") {
    return { enabled: [], ui: normalizeBatchImportUi(null) };
  }
  return {
    enabled: Array.isArray(raw.enabled) ? raw.enabled.filter((id) => typeof id === "string") : [],
    ui: normalizeBatchImportUi(raw.ui),
  };
}

async function loadMysqlBatchFlushConfig() {
  const data = await chrome.storage.local.get([MYSQL_BATCH_FLUSH_CONFIG_KEY]);
  return normalizeMysqlBatchFlushConfig(data[MYSQL_BATCH_FLUSH_CONFIG_KEY]);
}

async function saveMysqlBatchFlushConfig(config) {
  const normalized = normalizeMysqlBatchFlushConfig(config);
  await chrome.storage.local.set({ [MYSQL_BATCH_FLUSH_CONFIG_KEY]: normalized });
  return normalized;
}

function batchFlushMappingKey(enabled) {
  return (enabled || []).slice().sort().join("|");
}

function buildBatchFlushSummary(enabled, connectionsById = {}) {
  return (enabled || [])
    .map((id) => {
      const conn = connectionsById[id];
      if (!conn) return id;
      return `${conn.name} → ${conn.database || "?"}`;
    })
    .join(" · ");
}

function normalizeBatchFlushHistoryEntry(raw, connectionsById = null) {
  if (!raw || typeof raw !== "object") return null;
  const enabled = Array.isArray(raw.enabled) ? raw.enabled.filter((id) => typeof id === "string") : [];
  if (!enabled.length) return null;
  const validEnabled =
    connectionsById && Object.keys(connectionsById).length > 0
      ? enabled.filter((id) => connectionsById[id]?.database)
      : enabled;
  if (!validEnabled.length) return null;
  return {
    id: typeof raw.id === "string" ? raw.id : uuid(),
    savedAt: Number(raw.savedAt) || Date.now(),
    enabled: validEnabled,
    summary: raw.summary || buildBatchFlushSummary(validEnabled, connectionsById || {}),
  };
}

async function loadMysqlBatchFlushHistory() {
  const data = await chrome.storage.local.get([MYSQL_BATCH_FLUSH_HISTORY_KEY]);
  const list = Array.isArray(data[MYSQL_BATCH_FLUSH_HISTORY_KEY]) ? data[MYSQL_BATCH_FLUSH_HISTORY_KEY] : [];
  return list.map((item) => normalizeBatchFlushHistoryEntry(item)).filter(Boolean);
}

async function upsertMysqlBatchFlushHistory(preset, connectionsById = {}) {
  const enabled = (preset.enabled || []).filter((id) => connectionsById[id]?.database);
  if (!enabled.length) return loadMysqlBatchFlushHistory();

  const key = batchFlushMappingKey(enabled);
  const history = await loadMysqlBatchFlushHistory();
  const summary = buildBatchFlushSummary(enabled, connectionsById);
  const existingIdx = history.findIndex((item) => batchFlushMappingKey(item.enabled) === key);
  const entry = {
    id: existingIdx >= 0 ? history[existingIdx].id : uuid(),
    savedAt: Date.now(),
    enabled: [...enabled],
    summary,
  };

  if (existingIdx >= 0) history.splice(existingIdx, 1);
  history.unshift(entry);
  while (history.length > BATCH_FLUSH_HISTORY_LIMIT) history.pop();
  await chrome.storage.local.set({ [MYSQL_BATCH_FLUSH_HISTORY_KEY]: history });
  return history;
}

async function deleteMysqlBatchFlushHistoryEntry(id) {
  const history = await loadMysqlBatchFlushHistory();
  const next = history.filter((item) => item.id !== id);
  await chrome.storage.local.set({ [MYSQL_BATCH_FLUSH_HISTORY_KEY]: next });
  return next;
}

async function saveMysqlLookupCache(connectionId, prefs) {
  if (!connectionId || !prefs?.table) return;
  const data = await chrome.storage.local.get([MYSQL_LOOKUP_CACHE_KEY]);
  const cache = data[MYSQL_LOOKUP_CACHE_KEY] || {};
  cache[connectionId] = {
    table: prefs.table,
    keyColumn: prefs.keyColumn || "",
    valueColumn: prefs.valueColumn || "",
  };
  await chrome.storage.local.set({ [MYSQL_LOOKUP_CACHE_KEY]: cache });
}

async function loadAppTabOrder() {
  const data = await chrome.storage.local.get([APP_TAB_ORDER_KEY]);
  const order = data[APP_TAB_ORDER_KEY];
  return Array.isArray(order) ? order : null;
}

async function saveAppTabOrder(order) {
  await chrome.storage.local.set({ [APP_TAB_ORDER_KEY]: order });
}

function readTabOrder(container) {
  return [...container.querySelectorAll("[data-app-tab]")].map((btn) => btn.dataset.appTab);
}

// Reorder the tab buttons in the DOM to match a saved order (unknown keys keep their position).
function applyTabOrder(container, order) {
  if (!container || !Array.isArray(order)) return;
  order.forEach((key) => {
    const btn = container.querySelector(`[data-app-tab="${key}"]`);
    if (btn) container.appendChild(btn);
  });
}

// Enable HTML5 drag-and-drop reordering on a tab bar; persists order and calls onChange(order).
function enableTabDragSort(container, onChange) {
  if (!container) return;
  let dragEl = null;

  container.querySelectorAll("[data-app-tab]").forEach((btn) => {
    btn.setAttribute("draggable", "true");
  });

  container.addEventListener("dragstart", (event) => {
    const btn = event.target.closest("[data-app-tab]");
    if (!btn) return;
    dragEl = btn;
    btn.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", btn.dataset.appTab || "");
    } catch (_) {
      /* some browsers require a payload */
    }
  });

  container.addEventListener("dragover", (event) => {
    if (!dragEl) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = event.target.closest("[data-app-tab]");
    if (!target || target === dragEl) return;
    const rect = target.getBoundingClientRect();
    const insertBefore = event.clientX - rect.left < rect.width / 2;
    container.insertBefore(dragEl, insertBefore ? target : target.nextSibling);
  });

  container.addEventListener("drop", async (event) => {
    event.preventDefault();
    const order = readTabOrder(container);
    await saveAppTabOrder(order);
    if (typeof onChange === "function") onChange(order);
  });

  container.addEventListener("dragend", () => {
    if (dragEl) dragEl.classList.remove("dragging");
    dragEl = null;
  });
}

// Restore the saved tab order onto a container, then enable drag-to-reorder.
// Returns the key of the first tab in the restored order (for "open first tab" behavior).
async function initTabOrdering(container, onChange) {
  if (!container) return null;
  const order = await loadAppTabOrder();
  if (order) applyTabOrder(container, order);
  enableTabDragSort(container, onChange);
  const first = container.querySelector("[data-app-tab]");
  return first ? first.dataset.appTab : null;
}
