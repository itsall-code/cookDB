(() => {
const $ = (id) => document.getElementById(id);

const els = {
  connectionSelect: $("connectionSelect"),
  connectionMeta: $("connectionMeta"),
  historyList: $("historyList"),
  historyFavoriteOnly: $("historyFavoriteOnly"),
  statusPill: $("statusPill"),
  statusText: $("statusText"),
  queryEditor: $("queryEditor"),
  executeEditor: $("executeEditor"),
  allowDangerous: $("allowDangerous"),
  queryMeta: $("queryMeta"),
  queryTableWrap: $("queryTableWrap"),
  queryPageInfo: $("queryPageInfo"),
  executeResult: $("executeResult"),
  importPathSelect: $("importPathSelect"),
  importPath: $("importPath"),
  importConfirmHint: $("importConfirmHint"),
  importProgressBar: $("importProgressBar"),
  importStatus: $("importStatus"),
  importPercent: $("importPercent"),
  importSpeed: $("importSpeed"),
  importEta: $("importEta"),
  importStatements: $("importStatements"),
  importSkipped: $("importSkipped"),
  importPreview: $("importPreview"),
  importProgressPanel: $("importProgressPanel"),
  batchComposeList: $("batchComposeList"),
  batchComposeBody: $("batchComposeBody"),
  batchComposeSection: $("batchComposeSection"),
  batchComposeSummary: $("batchComposeSummary"),
  toggleBatchComposeSection: $("toggleBatchComposeSection"),
  batchImportHistoryList: $("batchImportHistoryList"),
  batchHistoryBody: $("batchHistoryBody"),
  batchHistorySection: $("batchHistorySection"),
  batchHistorySummary: $("batchHistorySummary"),
  batchHistoryEmptyHint: $("batchHistoryEmptyHint"),
  toggleBatchHistorySection: $("toggleBatchHistorySection"),
  batchImportSavedHint: $("batchImportSavedHint"),
  importBatchMeta: $("importBatchMeta"),
  batchFlushComposeList: $("batchFlushComposeList"),
  batchFlushComposeSection: $("batchFlushComposeSection"),
  batchFlushComposeSummary: $("batchFlushComposeSummary"),
  toggleBatchFlushComposeSection: $("toggleBatchFlushComposeSection"),
  batchFlushHistoryList: $("batchFlushHistoryList"),
  batchFlushHistorySection: $("batchFlushHistorySection"),
  batchFlushHistorySummary: $("batchFlushHistorySummary"),
  batchFlushHistoryEmptyHint: $("batchFlushHistoryEmptyHint"),
  toggleBatchFlushHistorySection: $("toggleBatchFlushHistorySection"),
  batchFlushSavedHint: $("batchFlushSavedHint"),
  flushBatchMeta: $("flushBatchMeta"),
  flushSingleMeta: $("flushSingleMeta"),
  toast: $("toast"),
};

let appState = null;
let activeTab = "query";
let queryResult = { columns: [], rows: [], limited: false, rowCount: 0 };
let querySort = { column: null, asc: true };
let queryPage = 1;
const PAGE_SIZE = 50;
let importJobId = null;
let importPollTimer = null;
let importPollInFlight = false;
let importTerminalHandled = false;
let importCompleteWaiter = null;
let importBatchQueue = [];
let importBatchRunning = false;
let importBatchAbort = false;
let importBatchContext = null;
let batchFlushQueue = [];
let batchFlushRunning = false;
let batchFlushAbort = false;
let batchFlushContext = null;
let batchImportConfig = { enabled: [], files: {}, ui: { composeCollapsed: true, historyCollapsed: true } };
let batchImportHistory = [];
let batchFlushConfig = { enabled: [], ui: { composeCollapsed: true, historyCollapsed: true } };
let batchFlushHistory = [];
let batchSaveHintTimer = null;
let batchFlushSaveHintTimer = null;
let lookupTables = [];
let sqlFileList = [];
let sqlScriptList = [];

function getImportPath() {
  const custom = els.importPath?.value.trim();
  if (custom) return custom;
  return els.importPathSelect?.value.trim() || "";
}

function getConnectionById(connectionId) {
  const list = appState?.settings?.mysqlConnections || [];
  return list.find((conn) => conn.id === connectionId) || null;
}

function setImportCancelButtonsDisabled(disabled) {
  $("cancelImportBtn") && ($("cancelImportBtn").disabled = disabled);
  $("cancelBatchImportBtn") && ($("cancelBatchImportBtn").disabled = disabled);
}

function normalizeImportStatus(status) {
  if (status == null) return "";
  return String(status).trim().toLowerCase();
}

function importStatusLabel(status) {
  switch (normalizeImportStatus(status)) {
    case "pending":
      return "等待中";
    case "running":
      return "导入中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status ? String(status) : "空闲";
  }
}

function isImportTerminalStatus(status) {
  return ["completed", "failed", "cancelled"].includes(normalizeImportStatus(status));
}

function resetImportUi() {
  if (els.importProgressBar) els.importProgressBar.style.width = "0%";
  if (els.importStatus) els.importStatus.textContent = importStatusLabel("idle");
  if (els.importPercent) els.importPercent.textContent = "0%";
  if (els.importSpeed) els.importSpeed.textContent = "0 B/s";
  if (els.importEta) els.importEta.textContent = "--";
  if (els.importStatements) els.importStatements.textContent = "0";
  if (els.importSkipped) els.importSkipped.textContent = "0";
  if (els.importPreview) els.importPreview.textContent = "";
}

function updateFlushBatchMeta() {
  if (!els.flushBatchMeta) return;
  if (!batchFlushRunning || !batchFlushContext) {
    els.flushBatchMeta.textContent = "";
    return;
  }
  const { index, total, connectionName, database } = batchFlushContext;
  els.flushBatchMeta.textContent = `批量清库 ${index}/${total} · 分支 ${connectionName} → ${database}`;
}

function isBatchJobRunning() {
  return Boolean(importBatchRunning || importJobId || batchFlushRunning);
}

function updateImportBatchMeta() {
  if (!els.importBatchMeta) return;
  if (!importBatchRunning || !importBatchContext) {
    els.importBatchMeta.textContent = "";
    return;
  }
  const { index, total, filePath, connectionName } = importBatchContext;
  const fileName = filePath ? filePath.split(/[/\\]/).pop() : filePath;
  els.importBatchMeta.textContent = `批量导入 ${index}/${total} · 分支 ${connectionName} → ${fileName}`;
}

function updateImportProgressPanelVisibility(tab = activeTab) {
  if (!els.importProgressPanel) return;
  const visible = tab === "import" || tab === "import-batch";
  els.importProgressPanel.hidden = !visible;
}

function showToast(message, ok = true) {
  els.toast.textContent = message;
  els.toast.className = `wb-toast show ${ok ? "ok" : "error"}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2800);
}

function setStatus(text, mode = "idle") {
  els.statusText.textContent = text;
  els.statusPill.className = "wb-status-pill";
  if (mode === "ok") els.statusPill.classList.add("ok");
  if (mode === "error") els.statusPill.classList.add("error");
  if (mode === "busy") els.statusPill.classList.add("busy");
}

function getActiveConnection() {
  if (!appState?.settings) return null;
  const list = appState.settings.mysqlConnections || [];
  return list.find((c) => c.id === appState.mysqlActiveConnectionId) || list[0] || null;
}

function getEditor(id) {
  return document.getElementById(id);
}

function getEditorSql(id) {
  const editor = getEditor(id);
  if (!editor) return "";
  const selected = editor.selectionStart !== editor.selectionEnd
    ? editor.value.slice(editor.selectionStart, editor.selectionEnd)
    : "";
  const raw = (selected || editor.value).trim();
  return stripLeadingSqlComments(raw).replace(/;\s*$/, "");
}

function stripLeadingSqlComments(sql) {
  let rest = String(sql || "").trimStart();
  let changed = true;
  while (changed) {
    changed = false;
    if (rest.startsWith("--")) {
      const nextLine = rest.indexOf("\n");
      rest = nextLine >= 0 ? rest.slice(nextLine + 1).trimStart() : "";
      changed = true;
    } else if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end >= 0) {
        rest = rest.slice(end + 2).trimStart();
        changed = true;
      }
    }
  }
  return rest;
}

function normalizeQueryResult(data) {
  const rows = data?.rows ?? [];
  const columns = data?.columns ?? [];
  return {
    columns,
    rows,
    limited: Boolean(data?.limited),
    rowCount: data?.rowCount ?? data?.row_count ?? rows.length,
  };
}

function normalizeExecuteResult(data) {
  return {
    rowsAffected: data?.rowsAffected ?? data?.rows_affected ?? 0,
    lastInsertId: data?.lastInsertId ?? data?.last_insert_id ?? 0,
  };
}

function seedQueryEditor() {
  const editor = getEditor("queryEditor");
  if (!editor || editor.value.trim()) return;

  const lastQuery = (appState?.sqlHistory || []).find((item) => item.type === "query");
  if (lastQuery?.sql) {
    editor.value = lastQuery.sql;
    return;
  }

  const placeholder = editor.getAttribute("placeholder")?.trim();
  editor.value = placeholder || "SELECT 1 AS ok";
}

function renderConnections() {
  const list = appState.settings.mysqlConnections || [];
  els.connectionSelect.innerHTML = "";
  list.forEach((conn) => {
    const opt = document.createElement("option");
    opt.value = conn.id;
    opt.textContent = conn.name;
    if (conn.id === appState.mysqlActiveConnectionId) opt.selected = true;
    els.connectionSelect.appendChild(opt);
  });

  const conn = getActiveConnection();
  const connHtml = conn
    ? `<div>${escapeHtml(conn.name)} · ${escapeHtml(conn.host)}:${conn.port}</div>
       <div>库：${escapeHtml(conn.database || "(未指定)")}</div>
       <div>用户：${escapeHtml(conn.username)}</div>`
    : "请先在设置页添加 MySQL 连接";

  if (!conn) {
    els.connectionMeta.textContent = connHtml;
    if (els.flushSingleMeta) els.flushSingleMeta.innerHTML = connHtml;
    return;
  }

  els.connectionMeta.innerHTML = connHtml;
  if (els.flushSingleMeta) els.flushSingleMeta.innerHTML = connHtml;

  const filePath = getImportPath();
  if (els.importConfirmHint) {
    els.importConfirmHint.textContent = filePath
      ? `确认码：${importConfirmText(conn, filePath)}`
      : "请选择或填写 SQL 文件路径";
  }
}

function renderImportPathSelect() {
  const select = els.importPathSelect;
  if (!select) return;

  const prev = getImportPath();
  select.innerHTML = "";

  if (!sqlFileList.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "未找到 data 目录下的 SQL 文件";
    select.appendChild(opt);
    return;
  }

  sqlFileList.forEach((file) => {
    const opt = document.createElement("option");
    opt.value = file.path;
    const size = file.size ?? file.size_bytes ?? 0;
    opt.textContent = `${file.name} (${formatBytes(size)}) · ${file.path}`;
    if (file.path === prev) opt.selected = true;
    select.appendChild(opt);
  });

  if (!select.value && sqlFileList[0]) {
    select.value = sqlFileList[0].path;
  }
}

function buildSqlFileSelect(selectedPath = "") {
  const select = document.createElement("select");
  select.className = "wb-connection-select wb-batch-sql-select";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = sqlFileList.length ? "请选择 SQL 文件" : "暂无 SQL 文件";
  select.appendChild(blank);
  sqlFileList.forEach((file) => {
    const opt = document.createElement("option");
    opt.value = file.path;
    const size = file.size ?? file.size_bytes ?? 0;
    opt.textContent = `${file.name} (${formatBytes(size)})`;
    if (file.path === selectedPath) opt.selected = true;
    select.appendChild(opt);
  });
  return select;
}

async function loadBatchImportConfig() {
  batchImportConfig = await loadMysqlBatchImportConfig();
}

async function loadBatchImportHistory() {
  batchImportHistory = await loadMysqlBatchImportHistory();
}

function connectionsByIdMap() {
  const map = {};
  (appState?.settings?.mysqlConnections || []).forEach((conn) => {
    map[conn.id] = conn;
  });
  return map;
}

async function savePresetToHistory(preset) {
  batchImportHistory = await upsertMysqlBatchImportHistory(preset, connectionsByIdMap());
  renderBatchImportHistory();
}

async function persistBatchImportConfig() {
  batchImportConfig = await saveMysqlBatchImportConfig(batchImportConfig);
  flashBatchSavedHint();
}

function flashBatchSavedHint() {
  const hint = els.batchImportSavedHint;
  if (!hint) return;
  hint.hidden = false;
  clearTimeout(batchSaveHintTimer);
  batchSaveHintTimer = setTimeout(() => {
    hint.hidden = true;
  }, 1800);
}

function isBatchBranchEnabled(connectionId) {
  return batchImportConfig.enabled.includes(connectionId);
}

function setBatchBranchEnabled(connectionId, enabled) {
  const ids = new Set(batchImportConfig.enabled);
  if (enabled) ids.add(connectionId);
  else ids.delete(connectionId);
  batchImportConfig.enabled = [...ids];
}

function setBatchBranchFile(connectionId, filePath) {
  if (filePath) batchImportConfig.files[connectionId] = filePath;
  else delete batchImportConfig.files[connectionId];
}

function readBatchImportPairsFromUi() {
  return batchImportConfig.enabled
    .map((connectionId) => {
      const connection = getConnectionById(connectionId);
      const filePath = batchImportConfig.files[connectionId];
      if (!connection?.database || !filePath) return null;
      return { connectionId, connection, filePath };
    })
    .filter(Boolean);
}

function pairsFromBatchPreset(preset) {
  return (preset.enabled || [])
    .map((connectionId) => {
      const connection = getConnectionById(connectionId);
      const filePath = preset.files?.[connectionId];
      if (!connection?.database || !filePath) return null;
      return { connectionId, connection, filePath };
    })
    .filter(Boolean);
}

function formatBatchHistoryTime(ts) {
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function renderBatchComposeList() {
  const list = els.batchComposeList;
  if (!list) return;

  list.innerHTML = "";
  const connections = appState?.settings?.mysqlConnections || [];
  if (!connections.length) {
    list.innerHTML = '<div class="wb-batch-empty">请先在设置页添加 MySQL 连接</div>';
    return;
  }

  const header = document.createElement("div");
  header.className = "wb-batch-compose-head";
  header.innerHTML = `
    <span class="wb-batch-compose-col wb-batch-compose-col--check">导入</span>
    <span class="wb-batch-compose-col wb-batch-compose-col--branch">分支</span>
    <span class="wb-batch-compose-col wb-batch-compose-col--sql">SQL 文件</span>
  `;
  list.appendChild(header);

  connections.forEach((conn) => {
    const enabled = isBatchBranchEnabled(conn.id);
    const disabled = !conn.database;
    const row = document.createElement("div");
    row.className = `wb-batch-compose-row${enabled ? " is-checked" : ""}${disabled ? " is-disabled" : ""}`;
    row.dataset.connectionId = conn.id;

    const checkCol = document.createElement("label");
    checkCol.className = "wb-batch-compose-col wb-batch-compose-col--check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabled;
    checkbox.disabled = disabled;
    checkbox.dataset.batchBranch = "1";
    checkCol.appendChild(checkbox);

    const branchCol = document.createElement("div");
    branchCol.className = "wb-batch-compose-col wb-batch-compose-col--branch";
    branchCol.innerHTML = `
      <strong>${escapeHtml(conn.name)}</strong>
      <em>${escapeHtml(conn.database || "未配置 database")}</em>
    `;

    const sqlCol = document.createElement("div");
    sqlCol.className = "wb-batch-compose-col wb-batch-compose-col--sql";
    const select = buildSqlFileSelect(batchImportConfig.files[conn.id] || "");
    select.dataset.batchSql = "1";
    select.disabled = disabled || !sqlFileList.length;
    sqlCol.appendChild(select);

    row.appendChild(checkCol);
    row.appendChild(branchCol);
    row.appendChild(sqlCol);
    list.appendChild(row);
  });
}

function renderBatchImportHistory() {
  const list = els.batchImportHistoryList;
  const emptyHint = els.batchHistoryEmptyHint;
  if (!list) return;

  list.innerHTML = "";
  if (!batchImportHistory.length) {
    if (emptyHint) emptyHint.hidden = false;
    if (els.batchHistorySummary) els.batchHistorySummary.textContent = "";
    return;
  }

  if (emptyHint) emptyHint.hidden = true;
  if (els.batchHistorySummary) {
    els.batchHistorySummary.textContent = batchImportHistory.length
      ? `${batchImportHistory.length} 条`
      : "";
  }

  batchImportHistory.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "wb-batch-history-item";
    row.dataset.historyId = entry.id;

    const main = document.createElement("div");
    main.className = "wb-batch-history-main";
    main.innerHTML = `
      <div class="wb-batch-history-summary">${escapeHtml(entry.summary || "")}</div>
      <div class="wb-batch-history-meta">${entry.enabled.length} 个分支 · ${formatBatchHistoryTime(entry.savedAt)}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "wb-batch-history-actions";
    actions.innerHTML = `
      <button type="button" class="secondary" data-batch-history-run="${escapeHtml(entry.id)}">运行</button>
      <button type="button" class="secondary wb-batch-history-delete" data-batch-history-del="${escapeHtml(entry.id)}">删除</button>
    `;

    row.appendChild(main);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

function ensureBatchImportUi() {
  if (!batchImportConfig.ui) {
    batchImportConfig.ui = { composeCollapsed: true, historyCollapsed: true };
  }
}

function updateBatchSectionSummaries() {
  const enabledCount = batchImportConfig.enabled.length;
  const mappedCount = batchImportConfig.enabled.filter((id) => batchImportConfig.files[id]).length;

  if (els.batchComposeSummary) {
    if (!enabledCount) els.batchComposeSummary.textContent = "";
    else els.batchComposeSummary.textContent = `已选 ${enabledCount} · 已指定 ${mappedCount}/${enabledCount}`;
  }
}

function applyBatchSectionCollapse() {
  ensureBatchImportUi();
  const { composeCollapsed, historyCollapsed } = batchImportConfig.ui;

  els.batchComposeSection?.classList.toggle("is-collapsed", composeCollapsed);
  els.toggleBatchComposeSection?.setAttribute("aria-expanded", composeCollapsed ? "false" : "true");

  els.batchHistorySection?.classList.toggle("is-collapsed", historyCollapsed);
  els.toggleBatchHistorySection?.setAttribute("aria-expanded", historyCollapsed ? "false" : "true");
}

async function toggleBatchSection(section) {
  ensureBatchImportUi();
  const key = section === "compose" ? "composeCollapsed" : "historyCollapsed";
  batchImportConfig.ui[key] = !batchImportConfig.ui[key];
  applyBatchSectionCollapse();
  await persistBatchImportConfig();
}

function renderBatchImportUi() {
  renderBatchComposeList();
  renderBatchImportHistory();
  updateBatchSectionSummaries();
  applyBatchSectionCollapse();
}

async function loadBatchFlushConfig() {
  batchFlushConfig = await loadMysqlBatchFlushConfig();
}

async function loadBatchFlushHistory() {
  batchFlushHistory = await loadMysqlBatchFlushHistory();
}

async function persistBatchFlushConfig() {
  batchFlushConfig = await saveMysqlBatchFlushConfig(batchFlushConfig);
  flashBatchFlushSavedHint();
}

function flashBatchFlushSavedHint() {
  const hint = els.batchFlushSavedHint;
  if (!hint) return;
  hint.hidden = false;
  clearTimeout(batchFlushSaveHintTimer);
  batchFlushSaveHintTimer = setTimeout(() => {
    hint.hidden = true;
  }, 1800);
}

function isBatchFlushBranchEnabled(connectionId) {
  return batchFlushConfig.enabled.includes(connectionId);
}

function setBatchFlushBranchEnabled(connectionId, enabled) {
  const ids = new Set(batchFlushConfig.enabled);
  if (enabled) ids.add(connectionId);
  else ids.delete(connectionId);
  batchFlushConfig.enabled = [...ids];
}

function readBatchFlushPairsFromUi() {
  return batchFlushConfig.enabled
    .map((connectionId) => {
      const connection = getConnectionById(connectionId);
      if (!connection?.database) return null;
      return { connectionId, connection };
    })
    .filter(Boolean);
}

function pairsFromBatchFlushPreset(preset) {
  return (preset.enabled || [])
    .map((connectionId) => {
      const connection = getConnectionById(connectionId);
      if (!connection?.database) return null;
      return { connectionId, connection };
    })
    .filter(Boolean);
}

async function saveFlushPresetToHistory(preset) {
  batchFlushHistory = await upsertMysqlBatchFlushHistory(preset, connectionsByIdMap());
  renderBatchFlushHistory();
}

function renderBatchFlushComposeList() {
  const list = els.batchFlushComposeList;
  if (!list) return;

  list.innerHTML = "";
  const connections = appState?.settings?.mysqlConnections || [];
  if (!connections.length) {
    list.innerHTML = '<div class="wb-batch-empty">请先在设置页添加 MySQL 连接</div>';
    return;
  }

  const header = document.createElement("div");
  header.className = "wb-batch-compose-head";
  header.innerHTML = `
    <span class="wb-batch-compose-col wb-batch-compose-col--check">清库</span>
    <span class="wb-batch-compose-col wb-batch-compose-col--branch">分支 / 目标库</span>
  `;
  list.appendChild(header);

  connections.forEach((conn) => {
    const enabled = isBatchFlushBranchEnabled(conn.id);
    const disabled = !conn.database;
    const row = document.createElement("div");
    row.className = `wb-batch-compose-row${enabled ? " is-checked" : ""}${disabled ? " is-disabled" : ""}`;
    row.dataset.connectionId = conn.id;

    const checkCol = document.createElement("label");
    checkCol.className = "wb-batch-compose-col wb-batch-compose-col--check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabled;
    checkbox.disabled = disabled;
    checkbox.dataset.batchFlushBranch = "1";
    checkCol.appendChild(checkbox);

    const branchCol = document.createElement("div");
    branchCol.className = "wb-batch-compose-col wb-batch-compose-col--branch";
    branchCol.innerHTML = `
      <strong>${escapeHtml(conn.name)}</strong>
      <em>${escapeHtml(conn.database || "未配置 database")}</em>
    `;

    row.appendChild(checkCol);
    row.appendChild(branchCol);
    list.appendChild(row);
  });
}

function renderBatchFlushHistory() {
  const list = els.batchFlushHistoryList;
  const emptyHint = els.batchFlushHistoryEmptyHint;
  if (!list) return;

  list.innerHTML = "";
  if (!batchFlushHistory.length) {
    if (emptyHint) emptyHint.hidden = false;
    if (els.batchFlushHistorySummary) els.batchFlushHistorySummary.textContent = "";
    return;
  }

  if (emptyHint) emptyHint.hidden = true;
  if (els.batchFlushHistorySummary) {
    els.batchFlushHistorySummary.textContent = batchFlushHistory.length
      ? `${batchFlushHistory.length} 条`
      : "";
  }

  batchFlushHistory.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "wb-batch-history-item";
    row.dataset.historyId = entry.id;

    const main = document.createElement("div");
    main.className = "wb-batch-history-main";
    main.innerHTML = `
      <div class="wb-batch-history-summary">${escapeHtml(entry.summary || "")}</div>
      <div class="wb-batch-history-meta">${entry.enabled.length} 个分支 · ${formatBatchHistoryTime(entry.savedAt)}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "wb-batch-history-actions";
    actions.innerHTML = `
      <button type="button" class="secondary" data-batch-flush-history-run="${escapeHtml(entry.id)}">运行</button>
      <button type="button" class="secondary wb-batch-history-delete" data-batch-flush-history-del="${escapeHtml(entry.id)}">删除</button>
    `;

    row.appendChild(main);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

function ensureBatchFlushUi() {
  if (!batchFlushConfig.ui) {
    batchFlushConfig.ui = { composeCollapsed: true, historyCollapsed: true };
  }
}

function updateBatchFlushSectionSummaries() {
  const enabledCount = batchFlushConfig.enabled.length;
  if (els.batchFlushComposeSummary) {
    els.batchFlushComposeSummary.textContent = enabledCount ? `已选 ${enabledCount} 个分支` : "";
  }
}

function applyBatchFlushSectionCollapse() {
  ensureBatchFlushUi();
  const { composeCollapsed, historyCollapsed } = batchFlushConfig.ui;

  els.batchFlushComposeSection?.classList.toggle("is-collapsed", composeCollapsed);
  els.toggleBatchFlushComposeSection?.setAttribute("aria-expanded", composeCollapsed ? "false" : "true");

  els.batchFlushHistorySection?.classList.toggle("is-collapsed", historyCollapsed);
  els.toggleBatchFlushHistorySection?.setAttribute("aria-expanded", historyCollapsed ? "false" : "true");
}

async function toggleBatchFlushSection(section) {
  ensureBatchFlushUi();
  const key = section === "compose" ? "composeCollapsed" : "historyCollapsed";
  batchFlushConfig.ui[key] = !batchFlushConfig.ui[key];
  applyBatchFlushSectionCollapse();
  await persistBatchFlushConfig();
}

function renderBatchFlushUi() {
  renderBatchFlushComposeList();
  renderBatchFlushHistory();
  updateBatchFlushSectionSummaries();
  applyBatchFlushSectionCollapse();
}

function setBatchFlushCancelButtonsDisabled(disabled) {
  const btn = $("cancelBatchFlushBtn");
  if (btn) btn.disabled = disabled;
}

async function loadSqlFiles() {
  if (!els.importPathSelect && !els.batchComposeList) return;

  try {
    const payload = await apiFetch(appState, "/api/mysql/sql-files", { method: "GET" });
    sqlFileList = payload.data || [];
    renderImportPathSelect();
    renderBatchImportUi();
    renderConnections();
  } catch (err) {
    sqlFileList = [];
    renderImportPathSelect();
    renderBatchImportUi();
    showToast(`加载 SQL 列表失败：${err.message}`, false);
  }
}

async function loadSqlScripts() {
  if (!els.historyList) return;

  try {
    const payload = await apiFetch(appState, "/api/mysql/scripts", { method: "GET" });
    sqlScriptList = payload.data || [];
    renderHistory();
  } catch (err) {
    sqlScriptList = [];
    renderHistory();
    showToast(`加载 SQL 脚本失败：${err.message}`, false);
  }
}

function formatHistoryTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatHistoryStats(item) {
  const parts = [];
  if (item.type === "query" && item.rowCount != null) parts.push(`${item.rowCount} 行`);
  if (item.durationMs != null) parts.push(`${item.durationMs} ms`);
  if (item.runCount > 1) parts.push(`执行 ${item.runCount} 次`);
  return parts.join(" · ");
}

function updateHistoryHint(count) {
  const hint = $("historyHint");
  if (!hint) return;
  hint.textContent = count
    ? `共 ${count} 个脚本 · 点击填入编辑器 · SQL 区可选中复制`
    : "backend/scripts 下暂无 SQL 脚本";
}

function renderHistory() {
  const templateOnly = els.historyFavoriteOnly?.checked;
  let scripts = [...sqlScriptList];
  if (templateOnly) scripts = scripts.filter((item) => item.kind === "template");
  updateHistoryHint(scripts.length);

  if (!els.historyList) return;
  els.historyList.innerHTML = "";

  if (!scripts.length) {
    els.historyList.innerHTML = '<div class="wb-history-empty">暂无 SQL 脚本</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  scripts.forEach((item) => {
    const row = document.createElement("div");
    const isTemplate = item.kind === "template";
    const typeLabel = isTemplate ? "模板" : item.kind === "audit" ? "巡检" : "工具";
    const typeClass = isTemplate ? "template" : "query";
    row.className = "wb-history-item";
    row.title = item.path;
    row.innerHTML = `
      <div class="wb-history-head">
        <span class="wb-history-type wb-history-type--${typeClass}">${typeLabel}</span>
        <span class="wb-history-conn">${escapeHtml(item.name || item.path)}</span>
        <span class="wb-history-time">${formatBytes(item.size)}</span>
      </div>
      <div class="sql-preview"><pre class="wb-history-sql">${escapeHtml(item.path)}</pre></div>
      <div class="wb-history-stats">${escapeHtml(isTemplate ? "点击加载到执行编辑器" : "点击加载到查询编辑器")}</div>
    `;
    row.addEventListener("click", async (event) => {
      if (event.target.closest(".wb-history-sql")) return;
      try {
        const payload = await apiFetch(appState, "/api/mysql/script", {
          method: "POST",
          body: JSON.stringify({ file_path: item.path }),
        });
        const script = payload.data;
        if (isTemplate) {
          switchTab("execute");
          const editor = getEditor("executeEditor");
          if (editor) editor.value = script.sql || "";
        } else {
          switchTab("query");
          const editor = getEditor("queryEditor");
          if (editor) editor.value = script.sql || "";
        }
        showToast("已加载 SQL 脚本");
      } catch (err) {
        showToast(`加载 SQL 脚本失败：${err.message}`, false);
      }
    });
    row.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      try {
        const payload = await apiFetch(appState, "/api/mysql/script", {
          method: "POST",
          body: JSON.stringify({ file_path: item.path }),
        });
        switchTab("execute");
        const editor = getEditor("executeEditor");
        if (editor) editor.value = payload.data?.sql || "";
        showToast("已加载到执行编辑器");
      } catch (err) {
        showToast(`加载 SQL 脚本失败：${err.message}`, false);
      }
    });
    frag.appendChild(row);
  });
  els.historyList.appendChild(frag);
}

function renderFlushUi() {
  renderBatchFlushUi();
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".wb-tabs button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".wb-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tab}`);
  });
  updateImportProgressPanelVisibility(tab);
  if (tab === "lookup" && !lookupTables.length) {
    refreshLookupTables().catch(() => {});
  }
  if (tab === "import-batch") {
    renderBatchImportUi();
  }
  if (tab === "flush") {
    renderFlushUi();
  }
}

function fillSelect(select, options, placeholder) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = placeholder;
  select.appendChild(blank);
  options.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    select.appendChild(opt);
  });
  if (current && options.includes(current)) select.value = current;
}

function getLookupPrefs() {
  return {
    table: $("lookupTable")?.value || "",
    keyColumn: $("lookupKeyColumn")?.value || "",
    valueColumn: $("lookupValueColumn")?.value || "",
  };
}

async function persistLookupCache() {
  const conn = getActiveConnection();
  if (!conn) return;
  const prefs = getLookupPrefs();
  if (!prefs.table) return;
  await saveMysqlLookupCache(conn.id, prefs);
}

async function applyLookupCache() {
  const conn = getActiveConnection();
  if (!conn) return;

  const cached = await loadMysqlLookupCache(conn.id);

  const tableSelect = $("lookupTable");
  if (!cached?.table || !tableSelect || !lookupTables.includes(cached.table)) return;

  tableSelect.value = cached.table;
  await loadLookupColumns(cached.table, cached);
}

function renderLookupResult(data) {
  const el = $("lookupResult");
  if (!el) return;
  const values = data?.values ?? [];
  const rowCount = data?.rowCount ?? data?.row_count ?? values.length;
  if (!rowCount) {
    el.className = "wb-lookup-result wb-empty";
    el.textContent = "未找到匹配记录";
    return;
  }
  const limited = data?.limited;
  const items = values
    .map((value) => {
      const text = value == null ? "NULL" : typeof value === "object" ? JSON.stringify(value) : String(value);
      return `<div class="wb-lookup-value copyable" data-copy="${escapeHtml(text)}" title="点击复制">${escapeHtml(text)}</div>`;
    })
    .join("");
  el.className = "wb-lookup-result";
  el.innerHTML = `
    <div class="wb-result-meta">
      <span class="wb-chip">${rowCount} 条</span>
      ${limited ? '<span class="wb-chip warn">仅展示前 100 条</span>' : ""}
    </div>
    ${items}
  `;
  el.querySelectorAll(".wb-lookup-value").forEach((node) => {
    node.addEventListener("click", async () => {
      await navigator.clipboard.writeText(node.dataset.copy || node.textContent);
      showToast("已复制");
    });
  });
}

function sortedRows() {
  const rows = [...queryResult.rows];
  if (!querySort.column) return rows;
  const col = querySort.column;
  rows.sort((a, b) => {
    const av = a[col];
    const bv = b[col];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return querySort.asc ? av - bv : bv - av;
    }
    const as = String(av);
    const bs = String(bv);
    return querySort.asc ? as.localeCompare(bs) : bs.localeCompare(as);
  });
  return rows;
}

function renderQueryTable() {
  const rows = sortedRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  queryPage = Math.min(queryPage, totalPages);
  const start = (queryPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  els.queryMeta.innerHTML = `
    <span class="wb-chip">${queryResult.rowCount} 行</span>
    ${queryResult.limited ? '<span class="wb-chip warn">结果已截断 (后端 LIMIT)</span>' : ""}
    <span class="wb-chip">${queryResult.columns.length} 列</span>
  `;

  if (!queryResult.columns.length) {
    els.queryTableWrap.innerHTML = '<div class="wb-empty">无数据</div>';
    els.queryPageInfo.textContent = "第 0 / 0 页";
    return;
  }

  const thead = queryResult.columns
    .map((col) => {
      const arrow = querySort.column === col ? (querySort.asc ? " ↑" : " ↓") : "";
      return `<th data-col="${escapeHtml(col)}">${escapeHtml(col)}${arrow}</th>`;
    })
    .join("");

  const tbody = pageRows
    .map((row) => {
      const cells = queryResult.columns
        .map((col) => {
          const value = row[col];
          const text = value == null ? "NULL" : typeof value === "object" ? JSON.stringify(value) : String(value);
          return `<td class="copyable" data-copy="${escapeHtml(text)}">${escapeHtml(text)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  els.queryTableWrap.innerHTML = `<table class="wb-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
  els.queryPageInfo.textContent = `第 ${queryPage} / ${totalPages} 页`;

  els.queryTableWrap.querySelectorAll("th").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (querySort.column === col) querySort.asc = !querySort.asc;
      else {
        querySort.column = col;
        querySort.asc = true;
      }
      renderQueryTable();
    });
  });

  els.queryTableWrap.querySelectorAll("td.copyable").forEach((td) => {
    td.addEventListener("click", async () => {
      await navigator.clipboard.writeText(td.dataset.copy || td.textContent);
      showToast("已复制单元格");
    });
  });
}

async function runQuery() {
  const conn = getActiveConnection();
  if (!conn) return showToast("请先在设置页添加 MySQL 连接", false);

  let sql = getEditorSql("queryEditor");
  if (!sql) {
    seedQueryEditor();
    sql = getEditorSql("queryEditor");
    if (!sql) return showToast("请先输入 SQL，或点击「加载表列表」快速生成", false);
  }

  setStatus("查询中...", "busy");
  const started = performance.now();
  try {
    const payload = await apiFetch(
      appState,
      "/api/mysql/query",
      {
        method: "POST",
        body: JSON.stringify({ target: connectionToTarget(conn), sql, limit: 1000 }),
      },
      LONG_TIMEOUT
    );
    queryResult = normalizeQueryResult(payload.data);
    queryPage = 1;
    querySort = { column: null, asc: true };
    renderQueryTable();
    const durationMs = Math.round(performance.now() - started);
    setStatus(`查询完成 · ${queryResult.rowCount} 行 · ${durationMs}ms`, "ok");
    showToast(`返回 ${queryResult.rowCount} 行`);
    appState.sqlHistory = await pushSqlHistory({
      sql,
      connectionName: conn.name,
      type: "query",
      durationMs,
      rowCount: queryResult.rowCount,
    });
    renderHistory();
  } catch (err) {
    setStatus(err.message, "error");
    showToast(err.message, false);
  }
}

async function runExecute() {
  const conn = getActiveConnection();
  if (!conn) return showToast("请先在设置页添加 MySQL 连接", false);

  const sql = getEditorSql("executeEditor");
  if (!sql) return showToast("请先输入要执行的 SQL", false);

  const dangerous = isDangerousSql(sql);
  const allowDangerous = els.allowDangerous.checked;
  if (dangerous && !allowDangerous) {
    return showToast("危险语句已拦截，请勾选允许危险语句", false);
  }

  const confirmText = executeConfirmText(conn, dangerous && allowDangerous);
  const danger = dangerous && allowDangerous ? "⚠ 危险语句\n" : "";
  const ok = window.confirm(`${danger}确认在【${conn.name}】执行以下 SQL？\n\n${sql}`);
  if (!ok) return showToast("已取消", false);

  setStatus("执行中...", "busy");
  const started = performance.now();
  try {
    const payload = await apiFetch(
      appState,
      "/api/mysql/execute",
      {
        method: "POST",
        body: JSON.stringify({
          target: connectionToTarget(conn),
          sql,
          confirm_text: confirmText,
          allow_dangerous: allowDangerous,
        }),
      },
      LONG_TIMEOUT
    );
    const result = normalizeExecuteResult(payload.data);
    const durationMs = Math.round(performance.now() - started);
    els.executeResult.innerHTML = `
      <div class="wb-result-meta">
        <span class="wb-chip">影响行数 ${result.rowsAffected}</span>
        <span class="wb-chip">last_insert_id ${result.lastInsertId}</span>
        <span class="wb-chip">${durationMs} ms</span>
      </div>
    `;
    setStatus("执行成功", "ok");
    showToast("语句执行成功");
    appState.sqlHistory = await pushSqlHistory({
      sql,
      connectionName: conn.name,
      type: "execute",
      durationMs,
      rowCount: result.rowsAffected,
    });
    renderHistory();
  } catch (err) {
    els.executeResult.textContent = err.message;
    setStatus(err.message, "error");
    showToast(err.message, false);
  }
}

async function loadTables() {
  const conn = getActiveConnection();
  if (!conn) return;
  setStatus("加载表列表...", "busy");
  try {
    const payload = await apiFetch(appState, "/api/mysql/tables", {
      method: "POST",
      body: JSON.stringify({ target: connectionToTarget(conn) }),
    });
    const tables = payload.data || [];
    if (!tables.length) {
      showToast("当前库没有表", false);
      return;
    }
    const snippet = `SELECT * FROM \`${tables[0]}\` LIMIT 20`;
    const editor = getEditor("queryEditor");
    if (editor) editor.value = snippet;
    showToast(`已加载 ${tables.length} 张表`);
    setStatus("表列表已加载", "ok");
  } catch (err) {
    setStatus(err.message, "error");
    showToast(err.message, false);
  }
}

async function refreshLookupTables() {
  const conn = getActiveConnection();
  if (!conn) return showToast("请先在设置页添加 MySQL 连接", false);

  const currentPrefs = getLookupPrefs();
  setStatus("加载表列表...", "busy");
  try {
    const payload = await apiFetch(appState, "/api/mysql/tables", {
      method: "POST",
      body: JSON.stringify({ target: connectionToTarget(conn) }),
    });
    lookupTables = payload.data || [];
    fillSelect($("lookupTable"), lookupTables, "请选择表");
    fillSelect($("lookupKeyColumn"), [], "请选择列");
    fillSelect($("lookupValueColumn"), [], "请选择列");
    if (!lookupTables.length) {
      showToast("当前库没有表", false);
      setStatus("无可用表", "error");
      return;
    }
    if (currentPrefs.table && lookupTables.includes(currentPrefs.table)) {
      $("lookupTable").value = currentPrefs.table;
      await loadLookupColumns(currentPrefs.table, currentPrefs);
    } else {
      await applyLookupCache();
    }
    setStatus(`已加载 ${lookupTables.length} 张表`, "ok");
    showToast(`已加载 ${lookupTables.length} 张表`);
  } catch (err) {
    setStatus(err.message, "error");
    showToast(err.message, false);
  }
}

async function loadLookupColumns(table, preferred = null) {
  const conn = getActiveConnection();
  if (!conn || !table) {
    fillSelect($("lookupKeyColumn"), [], "请选择列");
    fillSelect($("lookupValueColumn"), [], "请选择列");
    return;
  }
  try {
    const payload = await apiFetch(appState, "/api/mysql/columns", {
      method: "POST",
      body: JSON.stringify({ target: connectionToTarget(conn), table }),
    });
    const columns = payload.data || [];
    fillSelect($("lookupKeyColumn"), columns, "请选择列");
    fillSelect($("lookupValueColumn"), columns, "请选择列");

    const keySelect = $("lookupKeyColumn");
    const valueSelect = $("lookupValueColumn");
    if (preferred?.keyColumn && columns.includes(preferred.keyColumn)) {
      keySelect.value = preferred.keyColumn;
    } else if (columns.length >= 2) {
      keySelect.value = columns[0];
    } else if (columns.length === 1) {
      keySelect.value = columns[0];
    }

    if (preferred?.valueColumn && columns.includes(preferred.valueColumn)) {
      valueSelect.value = preferred.valueColumn;
    } else if (columns.length >= 2) {
      valueSelect.value = columns[1];
    } else if (columns.length === 1) {
      valueSelect.value = columns[0];
    }

    $("lookupKeyValue")?.focus();
  } catch (err) {
    showToast(err.message, false);
  }
}

async function runLookup() {
  const conn = getActiveConnection();
  if (!conn) return showToast("请先在设置页添加 MySQL 连接", false);

  const table = $("lookupTable")?.value;
  const keyColumn = $("lookupKeyColumn")?.value;
  const keyValue = $("lookupKeyValue")?.value.trim();
  const valueColumn = $("lookupValueColumn")?.value;

  if (!table) return showToast("请选择数据表", false);
  if (!keyColumn) return showToast("请选择条件列", false);
  if (!keyValue) return showToast("请填写条件值", false);
  if (!valueColumn) return showToast("请选择返回列", false);

  setStatus("单表查询中...", "busy");
  const started = performance.now();
  try {
    const payload = await apiFetch(
      appState,
      "/api/mysql/lookup",
      {
        method: "POST",
        body: JSON.stringify({
          target: connectionToTarget(conn),
          table,
          key_column: keyColumn,
          key_value: keyValue,
          value_column: valueColumn,
        }),
      },
      LONG_TIMEOUT
    );
    const result = payload.data || {};
    renderLookupResult(result);
    const rowCount = result.rowCount ?? result.row_count ?? result.values?.length ?? 0;
    const durationMs = Math.round(performance.now() - started);
    setStatus(`查询完成 · ${rowCount} 条 · ${durationMs}ms`, rowCount ? "ok" : "idle");
    showToast(rowCount ? `找到 ${rowCount} 条` : "未找到匹配记录", Boolean(rowCount));
    await persistLookupCache();
  } catch (err) {
    setStatus(err.message, "error");
    showToast(err.message, false);
  }
}

function exportCsv() {
  const rows = sortedRows();
  if (!rows.length) return showToast("没有可导出的数据", false);
  const header = queryResult.columns.join(",");
  const body = rows
    .map((row) =>
      queryResult.columns
        .map((col) => {
          const value = row[col];
          const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
          return `"${text.replaceAll('"', '""')}"`;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "query-result.csv";
  a.click();
  URL.revokeObjectURL(url);
  showToast("CSV 已导出");
}

function normalizeImportProgress(progress) {
  if (!progress) {
    return {
      job_id: null,
      status: "",
      file_path: "",
      file_size: 0,
      bytes_read: 0,
      statements_executed: 0,
      statements_skipped: 0,
      bytes_per_sec: 0,
      eta_sec: null,
      error: null,
      current_preview: null,
    };
  }

  const status = normalizeImportStatus(progress.status);
  return {
    job_id: progress.job_id ?? progress.jobId ?? null,
    status,
    file_path: progress.file_path ?? progress.filePath ?? "",
    file_size: progress.file_size ?? progress.fileSize ?? 0,
    bytes_read: progress.bytes_read ?? progress.bytesRead ?? 0,
    statements_executed: progress.statements_executed ?? progress.statementsExecuted ?? 0,
    statements_skipped: progress.statements_skipped ?? progress.statementsSkipped ?? 0,
    bytes_per_sec: progress.bytes_per_sec ?? progress.bytesPerSec ?? 0,
    eta_sec: progress.eta_sec ?? progress.etaSec,
    error: progress.error ?? null,
    current_preview: progress.current_preview ?? progress.currentPreview ?? null,
  };
}

function updateImportUi(rawProgress) {
  if (!els.importProgressBar) return;

  const progress = normalizeImportProgress(rawProgress);
  const percent = progress.file_size
    ? Math.min(100, Math.round((progress.bytes_read / progress.file_size) * 100))
    : 0;
  els.importProgressBar.style.width = `${percent}%`;
  els.importStatus.textContent = importStatusLabel(progress.status);
  els.importPercent.textContent = `${percent}%`;
  els.importSpeed.textContent = `${formatBytes(progress.bytes_per_sec)}/s`;
  els.importEta.textContent = progress.eta_sec != null ? formatDuration(progress.eta_sec * 1000) : "--";
  els.importStatements.textContent = String(progress.statements_executed);
  els.importSkipped.textContent = String(progress.statements_skipped);

  const preview =
    progress.status === "failed"
      ? progress.error || progress.current_preview || ""
      : progress.current_preview || "";
  els.importPreview.textContent = preview;
  updateImportBatchMeta();
}

function stopImportPolling() {
  if (importPollTimer) {
    clearInterval(importPollTimer);
    importPollTimer = null;
  }
}

function startImportPolling() {
  stopImportPolling();
  importPollTimer = setInterval(pollImportStatus, IMPORT_POLL_INTERVAL);
  pollImportStatus();
}

function waitForImportJob() {
  return new Promise((resolve, reject) => {
    importCompleteWaiter = { resolve, reject };
  });
}

function finishImportJob(progress, notify = true) {
  if (importTerminalHandled) return;
  importTerminalHandled = true;

  stopImportPolling();
  importPollInFlight = false;
  setImportCancelButtonsDisabled(true);
  importJobId = null;

  const status = normalizeImportStatus(progress.status);
  const fileName = progress.file_path ? progress.file_path.split(/[/\\]/).pop() : "SQL 文件";
  let result = { status, progress };

  if (status === "completed") {
    const stmtText =
      progress.statements_executed > 0
        ? `，执行 ${progress.statements_executed} 条语句`
        : "";
    const batchPrefix =
      importBatchRunning && importBatchContext
        ? `[${importBatchContext.connectionName}] (${importBatchContext.index}/${importBatchContext.total}) `
        : "";
    if (notify) {
      setStatus(`${batchPrefix}${fileName} 导入完成${stmtText}`, "ok");
      showToast(`${batchPrefix}导入完成${stmtText}`);
    }
    result.ok = true;
  } else if (status === "failed") {
    const message = progress.error || `${fileName} 导入失败`;
    if (notify) {
      setStatus(message, "error");
      showToast(message, false);
    }
    result.ok = false;
    result.error = message;
  } else {
    if (notify) {
      setStatus(`${fileName} 导入已取消`, "busy");
      showToast("导入已取消");
    }
    result.ok = false;
    result.error = "cancelled";
  }

  if (importCompleteWaiter) {
    const waiter = importCompleteWaiter;
    importCompleteWaiter = null;
    if (result.ok) waiter.resolve(result);
    else waiter.reject(new Error(result.error || "import failed"));
  }
}

async function pollImportStatus() {
  if (!importJobId || importPollInFlight || importTerminalHandled) return;

  const pollingJobId = importJobId;
  importPollInFlight = true;
  try {
    const payload = await apiFetch(appState, "/api/mysql/import-file/status", {
      method: "POST",
      body: JSON.stringify({ job_id: pollingJobId }),
    });
    if (pollingJobId !== importJobId || importTerminalHandled) return;

    const progress = normalizeImportProgress(payload.data);
    updateImportUi(progress);

    if (isImportTerminalStatus(progress.status)) {
      finishImportJob(progress, !importBatchRunning);
    }
  } catch (err) {
    if (importTerminalHandled || pollingJobId !== importJobId) return;
    if (els.importStatus) els.importStatus.textContent = "轮询中断，重试中…";
  } finally {
    importPollInFlight = false;
  }
}

async function flushDatabaseConnection(conn, options = {}) {
  if (!conn?.database) {
    throw new Error(`连接「${conn?.name || "未知"}」未指定 database，无法清库`);
  }

  const confirmText = flushDbConfirmText(conn);
  if (!options.skipConfirm) {
    const ok = window.confirm(
      `危险操作：将删除【${conn.name}】库中的全部表。\n\n${confirmText}\n\n确认清空？`
    );
    if (!ok) throw new Error("cancelled-by-user");
  }

  const payload = await apiFetch(
    appState,
    "/api/mysql/flush-db",
    {
      method: "POST",
      body: JSON.stringify({
        target: connectionToTarget(conn),
        confirm_text: confirmText,
      }),
    },
    LONG_TIMEOUT
  );
  return payload.data || {};
}

async function flushDatabase() {
  const conn = getActiveConnection();
  if (!conn) return showToast("请选择连接", false);
  if (isBatchJobRunning()) return showToast("已有批量任务进行中", false);

  setStatus("清库中...", "busy");
  try {
    const result = await flushDatabaseConnection(conn);
    const tablesDropped = result.tables_dropped ?? result.tablesDropped ?? 0;
    const database = result.database || conn.database || "";
    setStatus(`清库完成 · 删除 ${tablesDropped} 张表`, "ok");
    showToast(`已清空 ${database}，删除 ${tablesDropped} 张表`);
  } catch (err) {
    if (err.message === "cancelled-by-user") {
      showToast("已取消", false);
      return;
    }
    setStatus(err.message, "error");
    showToast(err.message, false);
  }
}

function buildBatchFlushConfirmSummary(pairs) {
  return pairs
    .map((pair, index) => `${index + 1}. [${pair.connection.name}] ${pair.connection.database}`)
    .join("\n");
}

function confirmBatchFlush(pairs) {
  const summary = buildBatchFlushConfirmSummary(pairs);
  return window.confirm(
    `危险操作：将按顺序清空 ${pairs.length} 个分支的目标库（删除全部表）：\n\n${summary}\n\n确认批量清库？`
  );
}

async function executeBatchFlushQueue(pairs) {
  if (!pairs.length) return;

  batchFlushQueue = [...pairs];
  batchFlushRunning = true;
  batchFlushAbort = false;
  setBatchFlushCancelButtonsDisabled(false);

  let successCount = 0;
  const total = batchFlushQueue.length;

  try {
    while (batchFlushQueue.length) {
      if (batchFlushAbort) break;

      const current = batchFlushQueue[0];
      batchFlushContext = {
        index: total - batchFlushQueue.length + 1,
        total,
        connectionName: current.connection.name,
        connectionId: current.connectionId,
        database: current.connection.database,
      };
      updateFlushBatchMeta();
      setStatus(`批量清库进行中：${batchFlushContext.index}/${total} · ${current.connection.name}`, "busy");

      try {
        const result = await flushDatabaseConnection(current.connection, { skipConfirm: true });
        const tablesDropped = result.tables_dropped ?? result.tablesDropped ?? 0;
        successCount += 1;
        batchFlushQueue.shift();
        setStatus(
          `批量清库进行中：${successCount}/${total} · ${current.connection.name} 已删 ${tablesDropped} 张表`,
          "busy"
        );
      } catch (err) {
        if (err.message === "cancelled-by-user") break;
        setStatus(`批量清库中断：${err.message}`, "error");
        showToast(
          `[${current.connection.name}] 第 ${batchFlushContext.index}/${total} 个分支失败：${err.message}`,
          false
        );
        break;
      }
    }

    if (batchFlushAbort) {
      setStatus("批量清库已取消", "busy");
      showToast("批量清库已取消");
    } else if (successCount === total) {
      setStatus(`批量清库完成，共 ${total} 个分支`, "ok");
      showToast(`批量清库完成，共 ${total} 个分支`);
    } else if (successCount > 0) {
      setStatus(`批量清库部分完成：${successCount}/${total}`, "busy");
      showToast(`批量清库部分完成：${successCount}/${total}`, false);
    }
  } finally {
    batchFlushQueue = [];
    batchFlushRunning = false;
    batchFlushAbort = false;
    batchFlushContext = null;
    setBatchFlushCancelButtonsDisabled(true);
    updateFlushBatchMeta();
  }
}

async function startBatchFlush() {
  if (isBatchJobRunning()) return showToast("已有任务进行中", false);

  const pairs = readBatchFlushPairsFromUi();
  if (!pairs.length) {
    if (batchFlushConfig.enabled.length) {
      return showToast("所选分支未配置 database，无法清库", false);
    }
    return showToast("请至少选择一个分支", false);
  }

  if (!confirmBatchFlush(pairs)) return showToast("已取消批量清库", false);

  await saveFlushPresetToHistory({
    enabled: pairs.map((pair) => pair.connectionId),
  });

  await executeBatchFlushQueue(pairs);
}

async function runBatchFlushFromHistory(entryId) {
  if (isBatchJobRunning()) return showToast("已有任务进行中", false);

  const entry = batchFlushHistory.find((item) => item.id === entryId);
  if (!entry) return showToast("历史记录不存在", false);

  const pairs = pairsFromBatchFlushPreset(entry);
  if (!pairs.length) {
    return showToast("历史记录中的分支已失效，请重新配置", false);
  }

  const missingCount = entry.enabled.length - pairs.length;
  if (missingCount > 0) {
    showToast(`部分分支已失效，将运行 ${pairs.length} 个`, false);
  }

  if (!confirmBatchFlush(pairs)) return showToast("已取消批量清库", false);

  await saveFlushPresetToHistory({
    enabled: pairs.map((pair) => pair.connectionId),
  });

  await executeBatchFlushQueue(pairs);
}

async function deleteBatchFlushHistoryEntry(entryId) {
  batchFlushHistory = await deleteMysqlBatchFlushHistoryEntry(entryId);
  renderBatchFlushHistory();
  showToast("已删除历史记录");
}

async function cancelBatchFlush() {
  if (batchFlushRunning) {
    batchFlushAbort = true;
    showToast("已请求取消批量清库");
  }
}

async function startImportFile(filePath, options = {}) {
  const conn = options.connection || getActiveConnection();
  if (!conn || !filePath) {
    throw new Error("请选择或填写 SQL 文件路径");
  }
  if (!conn.database) {
    throw new Error(`连接「${conn.name}」未指定 database，无法导入`);
  }

  if (!options.skipConfirm) {
    const ok = window.confirm(
      `导入将执行 DROP/CREATE/INSERT 等语句，覆盖目标库。\n\n分支：${conn.name}\n库：${conn.database}\n文件：${filePath}\n\n确认导入？`
    );
    if (!ok) throw new Error("cancelled-by-user");
  }

  importTerminalHandled = false;
  importCompleteWaiter = null;
  stopImportPolling();
  resetImportUi();

  const fileName = filePath.split(/[/\\]/).pop();
  setStatus(`正在启动导入：${conn.name} → ${fileName}`, "busy");
  setImportCancelButtonsDisabled(false);

  const confirmText = importConfirmText(conn, filePath);
  const payload = await apiFetch(
    appState,
    "/api/mysql/import-file",
    {
      method: "POST",
      body: JSON.stringify({
        target: connectionToTarget(conn),
        file_path: filePath,
        confirm_text: confirmText,
      }),
    },
    LONG_TIMEOUT
  );

  const progress = normalizeImportProgress(payload.data);
  importJobId = progress.job_id;
  if (!importJobId) {
    throw new Error("后端未返回 job_id，请确认后端已重新编译并重启");
  }

  updateImportUi(progress);
  const waitPromise = waitForImportJob();
  startImportPolling();
  if (!options.quietStart) showToast("导入任务已启动");
  return waitPromise;
}

async function startImport() {
  if (isBatchJobRunning()) return showToast("已有任务进行中", false);

  const filePath = getImportPath();
  if (!filePath) return showToast("请选择或填写 SQL 文件路径", false);

  try {
    await startImportFile(filePath);
  } catch (err) {
    setImportCancelButtonsDisabled(true);
    if (err.message === "cancelled-by-user") {
      showToast("已取消导入", false);
      return;
    }
    setStatus(err.message, "error");
    showToast(err.message, false);
  }
}

function buildBatchImportConfirmSummary(pairs) {
  return pairs
    .map((pair, index) => {
      const fileName = pair.filePath.split(/[/\\]/).pop();
      return `${index + 1}. [${pair.connection.name}] ${pair.connection.database} ← ${fileName}`;
    })
    .join("\n");
}

function confirmBatchImport(pairs) {
  const summary = buildBatchImportConfirmSummary(pairs);
  return window.confirm(
    `将按顺序导入 ${pairs.length} 组分支映射，每组覆盖对应目标库：\n\n${summary}\n\n确认批量导入？`
  );
}

async function executeBatchImportQueue(pairs) {
  if (!pairs.length) return;

  importBatchQueue = [...pairs];
  importBatchRunning = true;
  importBatchAbort = false;
  setImportCancelButtonsDisabled(false);

  let successCount = 0;
  const total = importBatchQueue.length;

  try {
    while (importBatchQueue.length) {
      if (importBatchAbort) break;

      const current = importBatchQueue[0];
      importBatchContext = {
        index: total - importBatchQueue.length + 1,
        total,
        filePath: current.filePath,
        connectionName: current.connection.name,
        connectionId: current.connectionId,
      };
      updateImportBatchMeta();

      try {
        await startImportFile(current.filePath, {
          connection: current.connection,
          skipConfirm: true,
          quietStart: true,
        });
        successCount += 1;
        importBatchQueue.shift();
        setStatus(`批量导入进行中：${successCount}/${total}`, "busy");
      } catch (err) {
        if (err.message === "cancelled-by-user" || err.message === "cancelled") {
          break;
        }
        setStatus(`批量导入中断：${err.message}`, "error");
        showToast(
          `[${current.connection.name}] 第 ${importBatchContext.index}/${total} 组失败：${err.message}`,
          false
        );
        break;
      }
    }

    if (importBatchAbort) {
      setStatus("批量导入已取消", "busy");
      showToast("批量导入已取消");
    } else if (successCount === total) {
      setStatus(`批量导入完成，共 ${total} 组分支映射`, "ok");
      showToast(`批量导入完成，共 ${total} 组分支映射`);
    } else if (successCount > 0) {
      setStatus(`批量导入部分完成：${successCount}/${total}`, "busy");
      showToast(`批量导入部分完成：${successCount}/${total}`, false);
    }
  } finally {
    importBatchQueue = [];
    importBatchRunning = false;
    importBatchAbort = false;
    importBatchContext = null;
    setImportCancelButtonsDisabled(true);
    updateImportBatchMeta();
  }
}

async function startBatchImport() {
  if (isBatchJobRunning()) return showToast("已有任务进行中", false);

  const pairs = readBatchImportPairsFromUi();
  if (!pairs.length) {
    const missingSql = batchImportConfig.enabled.some((id) => getConnectionById(id) && !batchImportConfig.files[id]);
    if (missingSql) return showToast("请为已选分支指定 SQL 文件", false);
    return showToast("请选择至少一个分支并配置 SQL", false);
  }

  const invalid = pairs.find((pair) => !pair.connection.database);
  if (invalid) {
    return showToast(`分支「${invalid.connection.name}」未指定 database`, false);
  }

  if (!confirmBatchImport(pairs)) return showToast("已取消批量导入", false);

  await savePresetToHistory({
    enabled: pairs.map((pair) => pair.connectionId),
    files: Object.fromEntries(pairs.map((pair) => [pair.connectionId, pair.filePath])),
  });

  await executeBatchImportQueue(pairs);
}

async function runBatchImportFromHistory(entryId) {
  if (isBatchJobRunning()) return showToast("已有任务进行中", false);

  const entry = batchImportHistory.find((item) => item.id === entryId);
  if (!entry) return showToast("历史记录不存在", false);

  const pairs = pairsFromBatchPreset(entry);
  if (!pairs.length) {
    return showToast("历史记录中的分支或 SQL 已失效，请重新配置", false);
  }

  const missingCount = entry.enabled.length - pairs.length;
  if (missingCount > 0) {
    showToast(`部分分支已失效，将运行 ${pairs.length} 组`, false);
  }

  if (!confirmBatchImport(pairs)) return showToast("已取消批量导入", false);

  await savePresetToHistory({
    enabled: pairs.map((pair) => pair.connectionId),
    files: Object.fromEntries(pairs.map((pair) => [pair.connectionId, pair.filePath])),
  });

  await executeBatchImportQueue(pairs);
}

async function deleteBatchImportHistoryEntry(entryId) {
  batchImportHistory = await deleteMysqlBatchImportHistoryEntry(entryId);
  renderBatchImportHistory();
  showToast("已删除历史记录");
}

async function cancelImport() {
  if (importBatchRunning) importBatchAbort = true;
  if (!importJobId) {
    if (importBatchRunning) showToast("已请求取消批量导入");
    return;
  }

  try {
    await apiFetch(appState, "/api/mysql/import-file/cancel", {
      method: "POST",
      body: JSON.stringify({ job_id: importJobId }),
    });
    showToast(importBatchRunning ? "已请求取消当前文件" : "已请求取消");
  } catch (err) {
    showToast(err.message, false);
  }
}

function bindEvents() {
  document.querySelectorAll(".wb-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  els.connectionSelect.addEventListener("change", async () => {
    appState.mysqlActiveConnectionId = els.connectionSelect.value;
    await chrome.storage.local.set({ mysqlActiveConnectionId: appState.mysqlActiveConnectionId });
    renderConnections();
    seedQueryEditor();
  });

  els.historyFavoriteOnly.addEventListener("change", renderHistory);
  $("refreshSqlScriptsBtn")?.addEventListener("click", loadSqlScripts);
  els.importPathSelect?.addEventListener("change", renderConnections);
  els.importPath?.addEventListener("input", renderConnections);
  $("refreshSqlFilesBtn")?.addEventListener("click", loadSqlFiles);
  $("refreshBatchSqlFilesBtn")?.addEventListener("click", loadSqlFiles);

  els.batchComposeList?.addEventListener("change", async (event) => {
    const checkbox = event.target.closest('input[type="checkbox"][data-batch-branch]');
    if (checkbox) {
      const row = checkbox.closest("[data-connection-id]");
      const connectionId = row?.dataset.connectionId;
      if (!connectionId) return;
      setBatchBranchEnabled(connectionId, checkbox.checked);
      row?.classList.toggle("is-checked", checkbox.checked);
      await persistBatchImportConfig();
      updateBatchSectionSummaries();
      return;
    }

    const select = event.target.closest("select[data-batch-sql]");
    if (!select) return;
    const connectionId = select.closest("[data-connection-id]")?.dataset.connectionId;
    if (!connectionId) return;
    setBatchBranchFile(connectionId, select.value);
    await persistBatchImportConfig();
    updateBatchSectionSummaries();
  });

  els.batchImportHistoryList?.addEventListener("click", async (event) => {
    const runBtn = event.target.closest("[data-batch-history-run]");
    if (runBtn) {
      event.preventDefault();
      await runBatchImportFromHistory(runBtn.dataset.batchHistoryRun);
      return;
    }
    const delBtn = event.target.closest("[data-batch-history-del]");
    if (delBtn) {
      event.preventDefault();
      if (!window.confirm("确定删除这条导入历史？")) return;
      await deleteBatchImportHistoryEntry(delBtn.dataset.batchHistoryDel);
    }
  });

  $("toggleBatchComposeSection")?.addEventListener("click", () => toggleBatchSection("compose"));
  $("toggleBatchHistorySection")?.addEventListener("click", () => toggleBatchSection("history"));
  $("toggleBatchFlushComposeSection")?.addEventListener("click", () => toggleBatchFlushSection("compose"));
  $("toggleBatchFlushHistorySection")?.addEventListener("click", () => toggleBatchFlushSection("history"));

  els.batchFlushComposeList?.addEventListener("change", async (event) => {
    const checkbox = event.target.closest('input[type="checkbox"][data-batch-flush-branch]');
    if (!checkbox) return;
    const row = checkbox.closest("[data-connection-id]");
    const connectionId = row?.dataset.connectionId;
    if (!connectionId) return;
    setBatchFlushBranchEnabled(connectionId, checkbox.checked);
    row?.classList.toggle("is-checked", checkbox.checked);
    await persistBatchFlushConfig();
    updateBatchFlushSectionSummaries();
  });

  els.batchFlushHistoryList?.addEventListener("click", async (event) => {
    const runBtn = event.target.closest("[data-batch-flush-history-run]");
    if (runBtn) {
      event.preventDefault();
      await runBatchFlushFromHistory(runBtn.dataset.batchFlushHistoryRun);
      return;
    }
    const delBtn = event.target.closest("[data-batch-flush-history-del]");
    if (delBtn) {
      event.preventDefault();
      if (!window.confirm("确定删除这条清库历史？")) return;
      await deleteBatchFlushHistoryEntry(delBtn.dataset.batchFlushHistoryDel);
    }
  });

  $("runQueryBtn").addEventListener("click", runQuery);
  $("runExecuteBtn").addEventListener("click", runExecute);
  $("loadTablesBtn").addEventListener("click", loadTables);
  $("refreshLookupBtn")?.addEventListener("click", refreshLookupTables);
  $("runLookupBtn")?.addEventListener("click", runLookup);
  $("lookupTable")?.addEventListener("change", async (event) => {
    await loadLookupColumns(event.target.value);
    await persistLookupCache();
  });
  $("lookupKeyColumn")?.addEventListener("change", () => persistLookupCache());
  $("lookupValueColumn")?.addEventListener("change", () => persistLookupCache());
  $("lookupKeyValue")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runLookup();
  });
  $("exportCsvBtn").addEventListener("click", exportCsv);
  $("queryPrevBtn").addEventListener("click", () => {
    queryPage = Math.max(1, queryPage - 1);
    renderQueryTable();
  });
  $("queryNextBtn").addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(sortedRows().length / PAGE_SIZE));
    queryPage = Math.min(totalPages, queryPage + 1);
    renderQueryTable();
  });
  $("startImportBtn").addEventListener("click", startImport);
  $("startBatchImportBtn")?.addEventListener("click", startBatchImport);
  $("startBatchFlushBtn")?.addEventListener("click", startBatchFlush);
  $("selectAllBatchImportBtn")?.addEventListener("click", async () => {
    const connections = appState?.settings?.mysqlConnections || [];
    batchImportConfig.enabled = connections.filter((c) => c.database).map((c) => c.id);
    await persistBatchImportConfig();
    renderBatchImportUi();
  });
  $("clearBatchImportBtn")?.addEventListener("click", async () => {
    batchImportConfig.enabled = [];
    await persistBatchImportConfig();
    renderBatchImportUi();
  });
  $("selectAllBatchFlushBtn")?.addEventListener("click", async () => {
    const connections = appState?.settings?.mysqlConnections || [];
    batchFlushConfig.enabled = connections.filter((c) => c.database).map((c) => c.id);
    await persistBatchFlushConfig();
    renderBatchFlushUi();
  });
  $("clearBatchFlushBtn")?.addEventListener("click", async () => {
    batchFlushConfig.enabled = [];
    await persistBatchFlushConfig();
    renderBatchFlushUi();
  });
  $("cancelImportBtn").addEventListener("click", cancelImport);
  $("cancelBatchImportBtn")?.addEventListener("click", cancelImport);
  $("cancelBatchFlushBtn")?.addEventListener("click", cancelBatchFlush);
  $("flushDbBtn")?.addEventListener("click", flushDatabase);

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      const mysqlPanel = $("tab-app-mysql");
      if (mysqlPanel && !mysqlPanel.classList.contains("active")) return;
      if (activeTab === "query") runQuery();
      if (activeTab === "lookup") runLookup();
      if (activeTab === "execute") runExecute();
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  appState = await loadAppState();
  await loadBatchImportConfig();
  await loadBatchImportHistory();
  await loadBatchFlushConfig();
  await loadBatchFlushHistory();
  bindEvents();
  renderConnections();
  renderHistory();
  renderBatchImportUi();
  renderBatchFlushUi();
  seedQueryEditor();
  await loadSqlScripts();
  await loadSqlFiles();
  updateImportProgressPanelVisibility(activeTab);
  setStatus("就绪");
});
})();
