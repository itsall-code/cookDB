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
  const list = appState.settings.mysqlConnections || [];
  return list.find((c) => c.id === appState.mysqlActiveConnectionId) || list[0];
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

  const filePath = els.importPath.value.trim() || "data/test_data.sql";
  els.importConfirmHint.textContent = `确认码：${importConfirmText(conn, filePath)}`;
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
        els.executeEditor.value = item.sql;
      } else {
        switchTab("query");
        els.queryEditor.value = item.sql;
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
  const sql = els.queryEditor.value.trim();
  if (!conn || !sql) return showToast("请填写连接与 SQL", false);

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
    queryResult = payload.data;
    queryPage = 1;
    querySort = { column: null, asc: true };
    renderQueryTable();
    const durationMs = Math.round(performance.now() - started);
    setStatus(`查询完成 · ${durationMs}ms`, "ok");
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
  const sql = els.executeEditor.value.trim();
  if (!conn || !sql) return showToast("请填写连接与 SQL", false);

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
    const result = payload.data;
    const durationMs = Math.round(performance.now() - started);
    els.executeResult.innerHTML = `
      <div class="wb-result-meta">
        <span class="wb-chip">影响行数 ${result.rows_affected}</span>
        <span class="wb-chip">last_insert_id ${result.last_insert_id}</span>
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
      rowCount: result.rows_affected,
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
    els.queryEditor.value = snippet;
    showToast(`已加载 ${tables.length} 张表`);
    setStatus("表列表已加载", "ok");
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

async function startImport() {
  const conn = getActiveConnection();
  const filePath = els.importPath.value.trim();
  if (!conn || !filePath) return showToast("请填写连接与文件路径", false);

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
  });

  els.historyFavoriteOnly.addEventListener("change", renderHistory);
  els.importPath.addEventListener("input", renderConnections);

  $("runQueryBtn").addEventListener("click", runQuery);
  $("runExecuteBtn").addEventListener("click", runExecute);
  $("loadTablesBtn").addEventListener("click", loadTables);
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

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      const mysqlPanel = $("tab-app-mysql");
      if (mysqlPanel && !mysqlPanel.classList.contains("active")) return;
      if (activeTab === "query") runQuery();
      if (activeTab === "execute") runExecute();
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  appState = await loadAppState();
  bindEvents();
  renderConnections();
  renderHistory();
  setStatus("就绪");
});
})();
