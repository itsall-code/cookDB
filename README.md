# Cook-DB

**本地游戏联调的数据库工作台** — Redis 读写与备份、MySQL 查询与导入、账号 MessagePack 本地化，一条链路跑通。

Rust 后端（`:8642`）+ Chrome 扩展面板 + 可选 Python 脚本。面向测试/联调场景，**不是**生产运维平台。

> **先读这句：** 本工具会执行 `FLUSHDB`、`DELETE`、`RESTORE REPLACE`、MySQL `DROP` 等不可逆操作。操作前确认目标库、备份与确认码；勿对生产或共享测试库直接动手。

---

## 30 秒看懂

| 维度 | 事实 |
| --- | --- |
| 默认端口 | `127.0.0.1:8642` |
| 扩展版本 | `0.3.0`（Manifest V3） |
| Redis | 连接测试、清库、删 Key、全库备份、Hash 读写（含 MessagePack 解码） |
| MySQL | SELECT 查询（默认 LIMIT 200，最大 1000）、DML/DDL 执行、流式 SQL 导入、清库 |
| 账号本地化 | 单账号 / 批量 / 全表 `HSCAN`，改写 platform、group、server |
| 配置存储 | 扩展 `chrome.storage.local`；后端 `backend/config/app.json` |
| 适用边界 | 本地或内网工具；CORS 宽松，**无鉴权** |

---

## 架构

```text
Chrome Extension
  popup.html      Redis 操作 + MySQL 入口
  mysql.html      MySQL 工作台（查询 / 执行 / 导入 / 清库）
  options.html    多环境 + 命名 MySQL 连接
        │ fetch JSON
        ▼
Axum Backend (:8642)
  routes/redis     连接、清库、备份、Hash
  routes/mysql     查询、执行、导入、元数据
  routes/process   账号本地化
        │
        ▼
Redis Server · MySQL Server
```

Python 脚本（`scripts/python/`）保留早期命令行菜单，适合离线批处理；**新功能优先走 Rust + 扩展**。

---

## 快速开始

### 1. 启动后端

```bash
cd backend
cargo run
```

默认监听 `http://127.0.0.1:8642`。修改 `backend/config/app.json`：

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 8642
  }
}
```

健康检查：

```bash
curl http://127.0.0.1:8642/api/health
```

### 2. 加载扩展

1. 打开 `chrome://extensions/`，启用「开发者模式」
2. 「加载已解压的扩展程序」→ 选择 `extension/`
3. 在 **选项页** 配置后端地址、Redis 源/目标库、MySQL 命名连接
4. 从 popup 进入 **MySQL 工作台**，或打开 `mysql.html`

### 3. 验证连接

- Redis：`POST /api/redis/test`
- MySQL：`POST /api/mysql/test`

扩展选项页可直接点「测试连接」。

---

## 项目结构

```text
cook-redis/
├── backend/                 Rust HTTP 服务
│   ├── config/app.json      监听地址
│   ├── data/                本地 SQL 文件（导入扫描目录）
│   └── src/
│       ├── routes/          薄路由层
│       ├── services/        Redis / MySQL / 本地化逻辑
│       └── models/          请求与响应结构
├── extension/               Chrome MV3 扩展
│   ├── popup.html/js        Redis + MySQL 快捷入口
│   ├── mysql.html/js        MySQL 完整工作台
│   └── options.html/js      环境与连接管理
└── scripts/python/          历史 CLI 工具（可选）
```

产品路线从 `cook-redis` 向 **cook-tools** 演进，详见 [`.cursor/skills/cook-tools/roadmap.md`](.cursor/skills/cook-tools/roadmap.md)。

---

## 扩展使用

### 环境模型

配置保存在 `chrome.storage.local`：

```javascript
{
  envs: { [name]: EnvConfig },
  activeEnv: "dev",
  mysqlConnections: [ /* 命名连接 */ ]
}
```

每个环境含 `apiBase`、源/目标 Redis、`mysql` 字段、`serverConfig`（本地化参数）。

### 三个入口

| 页面 | 用途 |
| --- | --- |
| `popup.html` | Redis 日常操作；MySQL 快捷 Tab（查询、导入、清库） |
| `mysql.html` | 完整 MySQL 工作台：连接切换、SQL 编辑、历史、批量导入 |
| `options.html` | 多环境 CRUD、MySQL 命名连接管理 |

`manifest.json` 默认允许 `http://127.0.0.1/*` 与 `http://localhost/*`。后端改端口时需同步 `host_permissions`。

---

## 能力说明

### Redis

- 连接测试、Ping
- 清空指定 DB（需确认码）
- 按 Key 或「表名」删除
- 源库 → 目标库全量备份（**会先 FLUSHDB 目标库**）
- Hash 字段读/写/列表；读取时自动尝试 MessagePack → JSON、UTF-8 或 Base64

### MySQL

- 连接测试、表列表、列列表、按主键列查单值
- 单条 `SELECT` 查询（后端包 LIMIT，默认 200，最大 1000）
- 单条 DML/DDL 执行（需确认码；`DELETE`/`TRUNCATE`/`DROP` 默认拦截）
- 清空当前 database（需确认码）
- 本地 `data/` 目录 SQL 文件流式导入（1MB 分块、200 条/批事务，不经浏览器上传）

### 账号本地化

从源 Redis Hash 读取 MessagePack 账号数据，改写 platform / group / server 等字段，写入目标库。支持：

- 单 Field：`/api/process/localize-account`
- 指定 Field 列表：`/api/process/localize-batch`
- 全表 HSCAN：`/api/process/localize-all-acc`

目标 Field 默认加前缀，如 `local_`、`yhzr2_`（由 `pre_login` 控制）。

---

## 配置结构

### RedisConfig

```json
{
  "host": "127.0.0.1",
  "port": 6379,
  "password": null,
  "db": 0
}
```

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

### ServerConfig（本地化）

```json
{
  "platform": "1",
  "group": "2",
  "server": "S2",
  "pre_login": "local_"
}
```

`platform` / `group` 能解析为整数时，优先写入数字字段。

---

## HTTP API

### 响应格式

成功：

```json
{ "success": true, "data": {}, "message": "ok" }
```

失败：

```json
{ "success": false, "message": "错误信息" }
```

### 路由总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务存活 |
| GET | `/api/redis/ping` | Redis 路由 Ping |
| POST | `/api/redis/test` | Redis 连接测试 |
| POST | `/api/redis/flushdb` | 清空 DB（需确认） |
| POST | `/api/redis/delete-keys` | 删 Key（需确认） |
| POST | `/api/redis/delete-tables` | 按表名删 Key（需确认） |
| POST | `/api/redis/backup` | 源库 → 目标库备份 |
| POST | `/api/redis/hash/get` | 读 Hash 字段 |
| POST | `/api/redis/hash/set` | 写 Hash 字段（Base64） |
| POST | `/api/redis/hash/list` | 列出 Hash 字段 |
| GET | `/api/mysql/ping` | MySQL 路由 Ping |
| POST | `/api/mysql/test` | MySQL 连接测试 |
| POST | `/api/mysql/tables` | 表列表 |
| POST | `/api/mysql/columns` | 指定表的列名 |
| POST | `/api/mysql/lookup` | 按主键列查单列值 |
| POST | `/api/mysql/query` | SELECT 查询 |
| POST | `/api/mysql/execute` | DML/DDL 执行 |
| POST | `/api/mysql/flush-db` | 清空 MySQL database |
| GET | `/api/mysql/sql-files` | 扫描 `data/` 下 `.sql` 文件 |
| POST | `/api/mysql/import-file` | 启动流式导入 |
| POST | `/api/mysql/import-file/status` | 查询导入进度 |
| POST | `/api/mysql/import-file/cancel` | 取消导入 |
| POST | `/api/process/localize-account` | 单账号本地化 |
| POST | `/api/process/localize-batch` | 批量本地化 |
| POST | `/api/process/localize-all-acc` | 全表本地化 |

### 确认码规则

危险操作必须严格匹配 `confirm_text`：

| 操作 | 格式 |
| --- | --- |
| Redis 清库 | `FLUSHDB db=<db> host=<host>` |
| Redis 删 Key | `DELETE <count> db=<db>` |
| Redis 删表名 Key | `DELETE_TABLES <count> db=<db>` |
| MySQL 执行 | `EXECUTE mysql <host> db=<database>` |
| MySQL 危险语句 | `DANGEROUS EXECUTE mysql <host> db=<database>` + `allow_dangerous: true` |
| MySQL 清库 | `FLUSH mysql <host> db=<database>` |
| MySQL 导入 | `IMPORT mysql <host> db=<database> file=<文件名>` |

### 常用示例

<details>
<summary><strong>Redis 连接测试</strong></summary>

```bash
curl -X POST http://127.0.0.1:8642/api/redis/test \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","port":6379,"password":null,"db":0}'
```

</details>

<details>
<summary><strong>Redis 清库</strong></summary>

```bash
curl -X POST http://127.0.0.1:8642/api/redis/flushdb \
  -H 'Content-Type: application/json' \
  -d '{"target":{"host":"127.0.0.1","port":6379,"password":null,"db":2},"confirm_text":"FLUSHDB db=2 host=127.0.0.1"}'
```

</details>

<details>
<summary><strong>Redis 备份（源 → 目标）</strong></summary>

将源 DB 所有 Key `DUMP` 后 `RESTORE` 到目标库；**执行前清空目标 DB**。

```bash
curl -X POST http://127.0.0.1:8642/api/redis/backup \
  -H 'Content-Type: application/json' \
  -d '{"source":{"host":"127.0.0.1","port":6379,"password":null,"db":1},"target":{"host":"127.0.0.1","port":6379,"password":null,"db":2}}'
```

</details>

<details>
<summary><strong>Redis Hash 读取</strong></summary>

响应 `data` 含 `decoded_type`（`msgpack-json` / `utf8-text` / `binary`）、`decoded_json`、`raw_base64` 等。

```bash
curl -X POST http://127.0.0.1:8642/api/redis/hash/get \
  -H 'Content-Type: application/json' \
  -d '{"target":{"host":"127.0.0.1","port":6379,"password":null,"db":2},"hash_name":"Account","field":"test_user"}'
```

</details>

<details>
<summary><strong>MySQL 查询</strong></summary>

仅允许单条 `SELECT`；后端包一层子查询 LIMIT。

```bash
curl -X POST http://127.0.0.1:8642/api/mysql/query \
  -H 'Content-Type: application/json' \
  -d '{"target":{"host":"127.0.0.1","port":3306,"username":"root","password":null,"database":"test"},"sql":"SELECT * FROM users","limit":50}'
```

</details>

<details>
<summary><strong>MySQL 执行</strong></summary>

```bash
curl -X POST http://127.0.0.1:8642/api/mysql/execute \
  -H 'Content-Type: application/json' \
  -d '{"target":{"host":"127.0.0.1","port":3306,"username":"root","password":null,"database":"test"},"sql":"UPDATE users SET flag = 1 WHERE id = 1","confirm_text":"EXECUTE mysql 127.0.0.1 db=test"}'
```

`DELETE` / `TRUNCATE` / `DROP` 需额外设置 `"allow_dangerous": true` 并使用 `DANGEROUS EXECUTE ...` 确认码。

</details>

<details>
<summary><strong>MySQL 流式导入</strong></summary>

```bash
# 列出可导入文件
curl http://127.0.0.1:8642/api/mysql/sql-files

# 启动导入
curl -X POST http://127.0.0.1:8642/api/mysql/import-file \
  -H 'Content-Type: application/json' \
  -d '{"target":{"host":"127.0.0.1","port":3306,"username":"root","password":null,"database":"game"},"file_path":"data/test_data.sql","confirm_text":"IMPORT mysql 127.0.0.1 db=game file=test_data.sql"}'

# 查询进度 / 取消
curl -X POST http://127.0.0.1:8642/api/mysql/import-file/status \
  -H 'Content-Type: application/json' \
  -d '{"job_id":"<uuid>"}'
```

进度字段含 `bytes_read`、`statements_executed`、`bytes_per_sec`、`eta_sec` 等。

</details>

<details>
<summary><strong>账号本地化（单账号）</strong></summary>

```bash
curl -X POST http://127.0.0.1:8642/api/process/localize-account \
  -H 'Content-Type: application/json' \
  -d '{
    "source":{"host":"127.0.0.1","port":6379,"password":null,"db":1},
    "target":{"host":"127.0.0.1","port":6379,"password":null,"db":2},
    "hash_name":"Account",
    "source_field":"player_001",
    "target_field":null,
    "server":{"platform":"1","group":"2","server":"S2","pre_login":"local_"}
  }'
```

`target_field` 为 `null` 时，写入 `pre_login + source_field`。

</details>

---

## 账号本地化规则

后端将 Hash 原始字节按 MessagePack 解码为 JSON，再递归改写：

1. **根数组**：前两个数字元素替换为 `platform`、`group`；内层数组同理。
2. **对象键**：`platform`/`plat`/`platformId`、`group`/`groupId`/`gid`、`server`/`sid`/`zone` 会被替换。
3. **字符串片段**：替换 `platform=...`、`gid=...`、`server=...` 及 `S数字` 形式的服务器标识。
4. **Field 命名**：批量/全表统一 `pre_login + 原 Field`。

非 MessagePack 的 Field 在批量接口中计入 `skipped`。

---

## 安全与边界

| 风险 | 说明 |
| --- | --- |
| 备份覆盖目标库 | `/api/redis/backup` 先 `FLUSHDB` 目标 DB |
| 删除不可恢复 | `delete-keys`、`flushdb`、`flush-db` 无软删除 |
| 无鉴权 | 适合本机；暴露到局域网需自行加反向代理认证 |
| 宽松 CORS | 方便扩展调用，不适合公网直出 |
| 大库备份 | 当前用 `KEYS *` + 逐 Key `DUMP`/`RESTORE`，大库建议低峰执行 |

**操作前备份。** 处理 `Account` 或跨服数据前，先复制到备份库验证。

---

## Python 脚本（可选）

```bash
python -m pip install redis msgpack
cd scripts/python/src
python cookredis.py
```

菜单含：源库导入、备份、本地化、清库、批量配置、跨服处理。配置在 `scripts/python/cfg/`。

> Windows 下 `clear()` 使用 `cls`；macOS/Linux 可改为 `clear`。

---

## 开发与检查

```bash
cd backend
cargo fmt --check
cargo check
cargo run
```

写入测试数据（确认 Redis 地址后再跑）：

```bash
cd scripts/python/test
python input_test_data.py
```

---

## 路线图

当前已完成 Redis 全套、MySQL API + 扩展工作台、账号本地化。后续按阶段推进：

| 阶段 | 方向 |
| --- | --- |
| P1 | 游戏脚本中心、SQL 模板库、数据快照 diff、Redis+MySQL 按 UID 联动 |
| P2 | Excel 导出、账号数据对比、批量 UID 执行 |

详见 [roadmap.md](.cursor/skills/cook-tools/roadmap.md) 与 [gap-analysis.md](.cursor/skills/cook-tools/gap-analysis.md)。

---

## 常见问题

**扩展连不上后端？**  
确认 `cargo run` 已启动、`curl /api/health` 正常、`options.html` 中 `apiBase` 与 `manifest.json` 的 `host_permissions` 一致。

**Redis 连接失败？**  
检查 host/port/db/password；无密码时传 `null`；Docker/远程库注意 bind 与防火墙。

**本地化报 MessagePack 解析失败？**  
先用 `/api/redis/hash/get` 看 `decoded_type`；非 MessagePack 数据需先确认格式。

**备份很慢？**  
大库 `KEYS *` 阻塞明显；后续可改 `SCAN` + Pipeline。

**Python 还是 Rust？**  
日常联调用 Rust + 扩展；历史批处理或离线场景可继续用 Python。

---

## License

见 [LICENSE](LICENSE)。
