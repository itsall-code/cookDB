# Cook-Tools 架构参考

## 请求流

```text
Chrome Extension (popup/options)
        │ fetch JSON
        ▼
Axum Router (backend, default :8642)
        │
   ┌────┴────┬──────────┐
   ▼         ▼          ▼
redis    mysql     process
service  service   service
   │         │          │
   ▼         ▼          ▼
 Redis     MySQL      Redis
 Server    Server     (读写+本地化)
```

## 现有 MySQL API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mysql/ping` | 路由存活 |
| POST | `/api/mysql/test` | 连接测试，body: `MySqlConfig` |
| POST | `/api/mysql/tables` | 表列表，body: `{ target: MySqlConfig }` |
| POST | `/api/mysql/query` | SELECT 查询，body: `{ target, sql, limit? }` |
| POST | `/api/mysql/execute` | 写入/DDL，body: `{ target, sql, confirm_text }` |

### MySqlConfig

```json
{
  "host": "127.0.0.1",
  "port": 3306,
  "username": "root",
  "password": null,
  "database": "game"
}
```

### 查询响应 MySqlQueryResult

```json
{
  "columns": ["uid", "name", "level"],
  "rows": [{ "uid": 10001, "name": "test", "level": 35 }],
  "row_count": 1,
  "limited": false
}
```

- 后端将用户 SQL 包在 `SELECT * FROM (...) AS cook_db_query LIMIT n` 中，默认 limit 200，最大 1000。
- 仅允许单条语句，不允许 `;` 多语句。

### 执行确认码

`confirm_text` 必须严格等于：

```text
EXECUTE mysql <host> db=<database>
```

`database` 为空时 `db=` 后为空字符串。

## 现有 Redis API（摘要）

| 路径 | 用途 |
|------|------|
| `/api/redis/test` | 连接测试 |
| `/api/redis/flushdb` | 清空 DB（需确认） |
| `/api/redis/delete-keys` | 删 Key |
| `/api/redis/delete-tables` | 按表名删 Key |
| `/api/redis/backup` | 源库 → 目标库全量复制 |
| `/api/redis/hash/get` | 读 Hash 字段（含 msgpack 解码） |
| `/api/redis/hash/set` | 写 Hash 字段（Base64） |
| `/api/redis/hash/list` | 列出 Hash 字段 |

## 扩展配置模型

```javascript
// defaultEnv() 结构
{
  apiBase: "http://127.0.0.1:8642",
  sourceRedis: { host, port, password, db },
  targetRedis: { host, port, password, db },
  mysql: { host, port, username, password, database },
  serverConfig: { platform, group, server, pre_login },
  defaultHashName: "Account",
  defaultTables: ["Account"],
  defaultDeleteKeys: []
}
```

多环境：`settings.envs[envName]`，在 `options.js` 编辑，`popup.js` 切换。

## 后端新增依赖建议

| 需求 | Rust crate |
|------|------------|
| Excel 导出 | `rust_xlsxwriter` 或后端生成 CSV |
| SQL 格式化 | `sqlformat` |
| 本地 SQL 历史/快照 | `sqlx` + SQLite，或仅存扩展 `chrome.storage` |
| 参数化模板 | 服务端字符串替换 + 白名单校验，不用拼接裸 SQL |

## 文件定位速查

| 改什么 | 文件 |
|--------|------|
| MySQL 业务逻辑 | `backend/src/services/mysql_service.rs` |
| MySQL 路由 | `backend/src/routes/mysql.rs` |
| 请求体 | `backend/src/models/request.rs` |
| MySQL 配置结构 | `backend/src/models/mysql.rs` |
| 扩展主面板 | `extension/popup.html`, `popup.js` |
| 扩展设置 | `extension/options.html`, `options.js` |
| 样式 | `extension/style.css` |
