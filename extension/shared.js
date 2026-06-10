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

  return {
    settings,
    activeEnv,
    sqlHistory: data.sqlHistory || [],
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
  const trimmed = sql.trim().toLowerCase();
  return ["delete", "truncate", "drop"].some((p) => trimmed.startsWith(p));
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

async function pushSqlHistory(entry) {
  const data = await chrome.storage.local.get(["sqlHistory"]);
  const history = data.sqlHistory || [];
  history.unshift({
    id: uuid(),
    favorite: false,
    executedAt: Date.now(),
    ...entry,
  });

  const favorites = history.filter((h) => h.favorite);
  const nonFavorites = history.filter((h) => !h.favorite);
  while (nonFavorites.length > 1000) nonFavorites.pop();

  const merged = [...favorites, ...nonFavorites].sort((a, b) => b.executedAt - a.executedAt);
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
