---
name: mysql-p0
description: >-
  Implements Cook-Tools MySQL P0 features: multi-connection management,
  SQL query UI, SQL execute with dangerous-statement guards, and SQL history.
  Use when building the first-phase MySQL workbench for cook-redis/cook-tools.
---

# MySQL P0：连接管理 + SQL 工作台

## 范围

1. 多数据库连接管理
2. SQL 查询（结果表格）
3. SQL 执行（安全限制）
4. SQL 历史记录

需求见 [roadmap.md](../cook-tools/roadmap.md) P0 段。

## 1. 多连接管理

### 目标配置

```json
{
  "name": "local",
  "host": "127.0.0.1",
  "port": 3306,
  "database": "game",
  "username": "root",
  "password": "******"
}
```

预设：`dev`、`test`、`staging`、`local`（名称可自定义）。

### 实现要点

**扩展侧（主改动）**

- 在 `EnvConfig` 或全局 `settings` 增加 `mysqlConnections: MySqlConnection[]`。
- `options.js`：连接列表 UI — 新增/编辑/删除/测试。
- 测试连接：复用 `POST /api/mysql/test`。
- `popup.js` 或新建 `mysql.html`：SQL 工作台选择当前连接。

**后端**

- `MySqlConfig` 可选增加 `name: Option<String>`（仅展示，不影响连接）。
- 连接信息**不持久化到后端**；保持无状态，每次请求带 `target`。

### 验收

- [ ] 可保存 ≥4 个命名连接
- [ ] 编辑/删除/测试均可用
- [ ] SQL 面板可切换连接

## 2. SQL 查询

### UI

- SQL 编辑器（`<textarea>` 或轻量代码区）
- 执行按钮 → `POST /api/mysql/query`
- 结果表：列头来自 `columns`，行来自 `rows`
- `limited === true` 时提示「结果已截断」

### 能力

| 能力 | 实现建议 |
|------|----------|
| 分页 | 前端对 `rows` 分页；或扩展 API 增加 `offset`（后端改动） |
| 排序 | 前端按列排序 |
| 复制单元格 | `navigator.clipboard.writeText` |
| 导出 Excel | P2 完整实现；P0 可先导出 CSV |

### 示例

```sql
SELECT * FROM player WHERE uid = 10001
```

## 3. SQL 执行

### UI

- 执行 Tab，独立编辑器
- 执行前弹确认，展示 `confirm_text` 供用户核对
- 成功显示 `rows_affected`、`last_insert_id`

### 安全加固（后端必做）

当前 `validate_mutation_sql` 允许 DELETE/DROP。P0 要求：

```rust
// 默认拒绝
const BLOCKED: &[&str] = &["delete", "truncate", "drop"];

// 请求体新增字段
pub allow_dangerous: Option<bool>  // 默认 false

// 若 SQL 以 blocked 开头且 allow_dangerous != true → 拒绝
// 若 allow_dangerous == true → 要求额外 confirm_text：
//   "DANGEROUS EXECUTE mysql {host} db={database}"
```

扩展侧：危险语句检测到后显示二次确认开关。

### 示例

```sql
UPDATE player SET gold = 999999 WHERE uid = 10001
```

确认码：`EXECUTE mysql 127.0.0.1 db=game`

## 4. SQL 历史

### 存储（扩展 `chrome.storage.local`）

```javascript
{
  sqlHistory: [
    {
      id: "uuid",
      sql: "SELECT ...",
      connectionName: "local",
      executedAt: 1717843200000,
      type: "query" | "execute",
      favorite: false,
      durationMs: 42,
      rowCount: 10
    }
  ]
}
```

- 最多保留 1000 条（FIFO 淘汰）
- 收藏不参与淘汰
- 侧边栏：历史列表 + 收藏筛选 + 点击回填编辑器

### 验收

- [ ] 每次查询/执行自动记录
- [ ] 可收藏、可快速重新执行
- [ ] 超过 1000 条时淘汰非收藏最旧记录

## 建议文件变更

| 文件 | 变更 |
|------|------|
| `extension/mysql.html` | 新建 SQL 工作台页面（推荐独立页，避免 popup 过挤） |
| `extension/mysql.js` | 查询/执行/历史逻辑 |
| `extension/options.js` | 连接 CRUD |
| `extension/manifest.json` | 注册新页面、权限 |
| `backend/src/models/request.rs` | `MySqlExecuteRequest` 增加 `allow_dangerous` |
| `backend/src/services/mysql_service.rs` | 危险语句拦截 |
| `backend/src/routes/mysql.rs` | 如需新端点 |

## 测试清单

```bash
cd backend && cargo check
```

手动：

1. 保存 local/dev 两个连接，切换测试
2. SELECT 返回表格，排序/复制正常
3. UPDATE 需确认码，成功显示 affected rows
4. DELETE 默认被拒绝；开启危险模式 + 二次确认后可执行（测试库）
5. 历史记录出现、收藏、重新执行

## 详细 API 见

[cook-tools/architecture.md](../cook-tools/architecture.md)
