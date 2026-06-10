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
let lookupTables = [];
let sqlFileList = [];

function getImportPath() {
  const custom = els.importPath?.value.trim();
  if (custom) return custom;
  return els.importPathSelect?.value.trim() || "";
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
  return getEditor(id)?.value.trim() || "";
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
  if (!conn) {
    els.connectionMeta.textContent = "请先在设置页添加 MySQL 连接";
    return;
  }

  els.connectionMeta.innerHTML = `
    <div>${escapeHtml(conn.host)}:${conn.port}</div>
    <div>库：${escapeHtml(conn.database || "(未指定)")}</div>
    <div>用户：${escapeHtml(conn.username)}</div>
  `;

  const filePath = getImportPath();
  els.importConfirmHint.textContent = filePath
    ? `确认码：${importConfirmText(conn, filePath)}`
    : "请选择或填写 SQL 文件路径";
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

async function loadSqlFiles() {
  if (!els.importPathSelect) return;

  try {
    const payload = await apiFetch(appState, "/api/mysql/sql-files", { method: "GET" });
    sqlFileList = payload.data || [];
    renderImportPathSelect();
    renderConnections();
  } catch (err) {
    sqlFileList = [];
    renderImportPathSelect();
    showToast(`加载 SQL 列表失败：${err.message}`, false);
  }
}

function renderHistory() {
  const onlyFavorite = els.historyFavoriteOnly.checked;
  const history = (appState.sqlHistory || []).filter((item) => !onlyFavorite || item.favorite);
  els.historyList.innerHTML = "";

  if (!history.length) {
    els.historyList.innerHTML = '<div class="subtitle" style="color:#94a3b8;">暂无历史记录</div>';
    return;
  }

  history.slice(0, 30).forEach((item) => {
    const row = document.createElement("div");
    row.className = "wb-history-item";
    row.innerHTML = `
      <div class="sql-preview">${escapeHtml(item.sql)}</div>
      <div class="meta">
        <span>${escapeHtml(item.connectionName || "")} · ${item.type}</span>
        <span>${item.favorite ? "★" : "☆"}</span>
      </div>
    `;
    row.addEventListener("click", () => {
      if (item.type === "execute") {
        switchTab("execute");
        const editor = getEditor("executeEditor");
        if (editor) editor.value = item.sql;
      } else {
        switchTab("query");
        const editor = getEditor("queryEditor");
        if (editor) editor.value = item.sql;
      }
    });
    row.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      appState.sqlHistory = await toggleSqlFavorite(item.id);
      renderHistory();
    });
    els.historyList.appendChild(row);
  });
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".wb-tabs button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".wb-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tab}`);
  });
  if (tab === "lookup" && !lookupTables.length) {
    refreshLookupTables().catch(() => {});
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

function clearLookupKeyValue() {
  const keyInput = $("lookupKeyValue");
  if (keyInput) keyInput.value = "";
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
  clearLookupKeyValue();

  const tableSelect = $("lookupTable");
  if (!cached?.table || !tableSelect || !lookupTables.includes(cached.table)) return;

  tableSelect.value = cached.table;
  await loadLookupColumns(cached.table, cached);
  clearLookupKeyValue();
}

function resetLookupForm() {
  lookupTables = [];
  fillSelect($("lookupTable"), [], "请选择表");
  fillSelect($("lookupKeyColumn"), [], "请选择列");
  fillSelect($("lookupValueColumn"), [], "请选择列");
  clearLookupKeyValue();
  const result = $("lookupResult");
  if (result) {
    result.className = "wb-lookup-result wb-empty";
    result.textContent = "查询结果将显示在这里";
  }
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
    renderLookupResult({ values: [], row_count: 0 });
    if (!lookupTables.length) {
      showToast("当前库没有表", false);
      setStatus("无可用表", "error");
      return;
    }
    await applyLookupCache();
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

    clearLookupKeyValue();
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
  return {
    job_id: progress.job_id ?? progress.jobId,
    status: progress.status,
    file_path: progress.file_path ?? progress.filePath,
    file_size: progress.file_size ?? progress.fileSize ?? 0,
    bytes_read: progress.bytes_read ?? progress.bytesRead ?? 0,
    statements_executed: progress.statements_executed ?? progress.statementsExecuted ?? 0,
    statements_skipped: progress.statements_skipped ?? progress.statementsSkipped ?? 0,
    bytes_per_sec: progress.bytes_per_sec ?? progress.bytesPerSec ?? 0,
    eta_sec: progress.eta_sec ?? progress.etaSec,
    error: progress.error,
    current_preview: progress.current_preview ?? progress.currentPreview,
  };
}

function updateImportUi(rawProgress) {
  const progress = normalizeImportProgress(rawProgress);
  const percent = progress.file_size
    ? Math.min(100, Math.round((progress.bytes_read / progress.file_size) * 100))
    : 0;
  els.importProgressBar.style.width = `${percent}%`;
  els.importStatus.textContent = progress.status || "unknown";
  els.importPercent.textContent = `${percent}%`;
  els.importSpeed.textContent = `${formatBytes(progress.bytes_per_sec)}/s`;
  els.importEta.textContent = progress.eta_sec != null ? formatDuration(progress.eta_sec * 1000) : "--";
  els.importStatements.textContent = String(progress.statements_executed);
  els.importSkipped.textContent = String(progress.statements_skipped);
  els.importPreview.textContent = progress.current_preview || progress.error || "";
}

async function pollImportStatus() {
  if (!importJobId) return;
  try {
    const payload = await apiFetch(appState, "/api/mysql/import-file/status", {
      method: "POST",
      body: JSON.stringify({ job_id: importJobId }),
    });
    const progress = payload.data;
    updateImportUi(progress);

    if (["completed", "failed", "cancelled"].includes(progress.status)) {
      clearInterval(importPollTimer);
      importPollTimer = null;
      $("cancelImportBtn").disabled = true;
      importJobId = null;
      if (progress.status === "completed") {
        setStatus("SQL 文件导入完成", "ok");
        showToast(`导入完成，执行 ${progress.statements_executed} 条语句`);
      } else if (progress.status === "failed") {
        setStatus(progress.error || "导入失败", "error");
        showToast(progress.error || "导入失败", false);
      } else {
        setStatus("导入已取消", "busy");
        showToast("导入已取消");
      }
    }
  } catch (err) {
    clearInterval(importPollTimer);
    importPollTimer = null;
    setStatus(err.message, "error");
    showToast(err.message, false);
  }
}

async function flushDatabase() {
  const conn = getActiveConnection();
  if (!conn) return showToast("请选择连接", false);
  if (!conn.database) return showToast("连接未指定 database，无法清库", false);

  const confirmText = flushDbConfirmText(conn);
  const ok = window.confirm(
    `危险操作：将删除【${conn.name}】库中的全部表。\n\n${confirmText}\n\n确认清空？`
  );
  if (!ok) return showToast("已取消", false);

  setStatus("清库中...", "busy");
  try {
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
    const result = payload.data || {};
    const tablesDropped = result.tables_dropped ?? result.tablesDropped ?? 0;
    const database = result.database || conn.database || "";
    setStatus(`清库完成 · 删除 ${tablesDropped} 张表`, "ok");
    showToast(`已清空 ${database}，删除 ${tablesDropped} 张表`);
  } catch (err) {
    setStatus(err.message, "error");
    showToast(err.message, false);
  }
}

async function startImport() {
  const conn = getActiveConnection();
  const filePath = getImportPath();
  if (!conn || !filePath) return showToast("请选择或填写 SQL 文件路径", false);

  const confirmText = importConfirmText(conn, filePath);
  const ok = window.confirm(`导入将执行 DROP/CREATE/INSERT 等语句，覆盖目标库。\n\n连接：${conn.name}\n文件：${filePath}\n\n确认导入？`);
  if (!ok) return showToast("已取消导入", false);

  setStatus("正在启动导入...", "busy");
  $("cancelImportBtn").disabled = false;
  try {
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
    if (importPollTimer) clearInterval(importPollTimer);
    importPollTimer = setInterval(pollImportStatus, IMPORT_POLL_INTERVAL);
    pollImportStatus();
    showToast("导入任务已启动");
  } catch (err) {
    $("cancelImportBtn").disabled = true;
    setStatus(err.message, "error");
    showToast(err.message, false);
  }
}

async function cancelImport() {
  if (!importJobId) return;
  try {
    await apiFetch(appState, "/api/mysql/import-file/cancel", {
      method: "POST",
      body: JSON.stringify({ job_id: importJobId }),
    });
    showToast("已请求取消");
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
    resetLookupForm();
    if (activeTab === "lookup") {
      await refreshLookupTables();
    }
  });

  els.historyFavoriteOnly.addEventListener("change", renderHistory);
  els.importPathSelect?.addEventListener("change", renderConnections);
  els.importPath?.addEventListener("input", renderConnections);
  $("refreshSqlFilesBtn")?.addEventListener("click", loadSqlFiles);

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
  $("cancelImportBtn").addEventListener("click", cancelImport);
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
  bindEvents();
  renderConnections();
  renderHistory();
  seedQueryEditor();
  await loadSqlFiles();
  setStatus("就绪");
});
})();
