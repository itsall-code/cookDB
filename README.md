# Cook-DB 使用文档

Cook-DB 是本地/内网联调用的数据库工作台，包含：

- Chrome 扩展：配置环境、执行 Redis 操作、使用 MySQL 工作台、生成更新信息。
- Rust 后端：提供 Redis、MySQL、账号本地化和 SQL 导入 API，默认监听 `127.0.0.1:8642`。
- 可选 Python 脚本：保留早期命令行批处理能力，日常优先使用扩展 + Rust 后端。

> 重要：本工具会执行清库、删除、覆盖导入、DDL/DML 等不可逆操作。请只连接本地或确认过的测试库，不要直接连接生产库。

---

## 1. 快速启动

### 1.1 启动后端

```bash
cd backend
cargo run
```

默认地址：

```text
http://127.0.0.1:8642
```

检查后端是否正常：

```bash
curl http://127.0.0.1:8642/api/health
```

如果需要改监听地址，编辑 [backend/config/app.json](backend/config/app.json)：

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 8642
  }
}
```

### 1.2 加载 Chrome 扩展

1. 打开 `chrome://extensions/`。
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择仓库里的 [extension](extension) 目录。
5. 打开扩展，先进入「系统设置」完成配置。

如果后端端口不是 `8642`，只需要在设置页修改 `API Base URL`。如果后端不是 localhost/127.0.0.1，还需要同步修改 [extension/manifest.json](extension/manifest.json) 的 `host_permissions`。

---

## 2. 第一次配置

所有前端配置保存在 Chrome 的 `chrome.storage.local` 中。配置入口是扩展里的「系统设置」，对应页面为 [extension/options.html](extension/options.html)。

### 2.1 环境管理

环境用于区分不同联调目标，例如：

- `local`：本机 Redis / MySQL。
- `dev`：开发服数据库。
- `qa`：测试服数据库。
- `branch-a`：某个分支环境。

操作方式：

1. 在「当前环境」选择要编辑的环境。
2. 如需新增环境，在「新环境名」输入名称，点击「新增环境」。
3. 编辑 Redis、MySQL、本地化等配置。
4. 点击底部「保存设置」。

注意：切换环境只会切换当前表单内容；修改后必须点「保存设置」。

### 2.2 后端接口

字段：`API Base URL`

默认填写：

```text
http://127.0.0.1:8642
```

填写规则：

- 和后端启动地址一致。
- 末尾可以带 `/`，程序会自动归一化。
- 修改后点击「测试后端健康检查」确认可用。

### 2.3 Redis 配置

设置页分为「源 Redis」和「目标 Redis」。

| 配置项 | 说明 | 示例 |
| --- | --- | --- |
| `Host` | Redis 地址 | `127.0.0.1` |
| `Port` | Redis 端口 | `6379` |
| `DB` | Redis DB 编号 | `0`、`1`、`2` |
| `Password` | Redis 密码 | 无密码时留空 |

源 Redis 和目标 Redis 的用途不同：

- 源 Redis：读取数据，例如备份来源、账号本地化来源。
- 目标 Redis：写入数据，例如备份目标、本地化写入目标、删除/清库目标。

高风险点：

- 「备份数据库」会把源 Redis 复制到目标 Redis，并覆盖目标库。
- 「清空目标 DB」「删除 Keys」「删除 Tables」只操作目标 Redis。
- 目标 Redis 请务必确认不是生产或共享库。

### 2.4 本地化配置

用于账号 MessagePack 数据本地化，配置项在「本地化配置」区域：

| 配置项 | 说明 | 示例 |
| --- | --- | --- |
| `Platform` | 写入账号数据中的平台字段 | `1` 或 `local` |
| `Group` | 写入账号数据中的分组字段 | `1` |
| `Server` | 写入账号数据中的服务器字段 | `S1` |
| `Pre Login` | 目标账号 Field 前缀 | `local_` |
| `Default Hash Name` | 默认账号 Hash 名 | `Account` |

Field 命名规则：

- 单账号本地化时，如果「目标账号 Field」留空，目标 Field 会自动变成 `Pre Login + 源账号 Field`。
- 例如源 Field 是 `hxc12_72049`，`Pre Login` 是 `local_`，目标 Field 就是 `local_hxc12_72049`。

### 2.5 默认删除配置

用于 Redis 面板里的默认输入：

| 配置项 | 说明 |
| --- | --- |
| 默认 tables | 每行一个表名/Key 名，填入后 Redis 面板会自动带出 |
| 默认 keys | 每行一个 Key，填入后 Redis 面板会自动带出 |

这里的内容只是默认值，不会自动执行删除。

### 2.6 MySQL 连接库

MySQL 连接是「命名连接」，可以保存多个，例如 `local`、`dev`、`qa`。

| 配置项 | 说明 | 示例 |
| --- | --- | --- |
| 连接名称 | 在工作台里显示的名称 | `local` |
| `Host` | MySQL 地址 | `127.0.0.1` |
| `Port` | MySQL 端口 | `3306` |
| `Database` | 默认操作的 database | `game` |
| `Username` | 用户名 | `root` |
| `Password` | 密码 | 无密码时留空 |

操作方式：

1. 在「MySQL 连接」Tab 中选择当前编辑连接。
2. 修改连接信息。
3. 点击「测试连接」确认可用。
4. 点击底部「保存设置」。

说明：

- 扩展里的 MySQL 工作台会读取这里保存的连接。
- 当前环境也会保存一个 `mysql` 字段，用于兼容快捷入口；日常使用以「MySQL 连接库」为准。

### 2.7 导入/导出配置

设置页提供：

- 「导出配置」：导出 `cookdb-settings.json`。
- 「导入配置」：导入之前导出的配置。

建议在配置好一套稳定环境后导出备份，换机器或重装扩展时直接导入。

---

## 3. Redis 面板怎么用

Redis 日常操作在扩展 Popup 的「Redis 工具」Tab 中。

### 3.1 选择环境

1. 在「当前环境」选择环境。
2. 确认下方环境摘要中的后端地址、源 Redis、目标 Redis。
3. 如发现不对，点击「编辑配置」回到设置页。

### 3.2 测试连接

1. 在「测试目标」选择：
   - 源 Redis
   - 目标 Redis
   - MySQL
2. 点击「测试连接」。
3. 查看顶部运行日志。

建议每次执行备份、清库、批量本地化前都先测试连接。

### 3.3 备份数据库

用途：把源 Redis 复制到目标 Redis。

步骤：

1. 确认当前环境的源 Redis 和目标 Redis。
2. 点击「执行备份」。
3. 浏览器弹窗确认后执行。
4. 查看运行日志中的复制数量。

注意：备份会覆盖目标 Redis DB。执行前请确认目标库可被覆盖。

### 3.4 单账号本地化

用途：从源 Redis 的某个 Hash Field 读取账号数据，改写 platform/group/server 等字段后写入目标 Redis。

步骤：

1. `Hash 名`：通常填 `Account`。
2. `源账号 Field`：填源账号 Field。
3. `目标账号 Field`：可留空，留空时自动使用 `Pre Login + 源账号 Field`。
4. 检查 `前缀 / pre_login`、`server`、`platform`、`group`。
5. 点击「执行本地化」。

示例：

```text
Hash 名：Account
源账号 Field：hxc12_72049
目标账号 Field：（留空）
前缀 / pre_login：local_
server：S1
platform：1
group：1
```

结果：写入目标 Redis 的 `Account.local_hxc12_72049`。

### 3.5 全库 acc 表本地化

用途：读取源 Redis 中指定 Hash 的所有 Field，批量本地化后写入目标 Redis。

步骤：

1. `Hash 名`：通常填 `Account`。
2. 检查 `pre_login`、`server`、`platform`、`group`。
3. 点击「执行全表本地化」。
4. 等待日志显示 scanned/localized/skipped/written。

注意：

- 只适合确认数据格式是 MessagePack 的账号 Hash。
- 非 MessagePack Field 会被计入 skipped。
- 大 Hash 可能耗时较久。

### 3.6 删除 Keys / Tables

用途：删除目标 Redis 中指定 Key。

步骤：

1. 在 `Keys` 或 `Tables` 文本框中每行输入一个 Key。
2. 点击「删除 Keys」或「删除 Tables」。
3. 浏览器弹窗会展示后端确认码。
4. 确认后执行。

说明：当前后端中 `Tables` 本质也是按传入名称删除 Key。

### 3.7 读取 Hash 字段并可视化

用途：查看 Redis Hash Field 原始内容和解码结果。

步骤：

1. 展开「读取 Hash 字段并可视化」。
2. 选择读取来源：source Redis 或 target Redis。
3. 输入 `Hash 名`。
4. 点击「列出字段」，选择或复制 Field。
5. 点击「读取并可视化」。

结果会尝试识别：

- MessagePack JSON
- UTF-8 文本
- 二进制 Base64

### 3.8 清空目标 DB

用途：执行目标 Redis 的 `FLUSHDB`。

步骤：

1. 再次确认当前环境的目标 Redis。
2. 点击「清空目标 DB」。
3. 浏览器弹窗会展示确认码。
4. 确认后执行。

这是高风险操作，不可恢复。

---

## 4. MySQL 工作台怎么用

MySQL 有两个入口：

- Popup 里的「MySQL 工作台」Tab：适合快速查询和导入。
- 完整页面 [extension/mysql.html](extension/mysql.html)：适合长时间工作，推荐使用。

### 4.1 选择连接

1. 打开 MySQL 工作台。
2. 在左侧或顶部选择 MySQL 连接。
3. 确认连接名称和 database。
4. 如连接不存在或错误，回到「系统设置」的「MySQL 连接」Tab 修改。

### 4.2 查询 SQL

用途：执行单条 `SELECT` 查询。

步骤：

1. 打开「查询」Tab。
2. 输入 SQL，例如：

```sql
SELECT * FROM account LIMIT 20
```

3. 点击「运行查询」。
4. 在结果表格中查看数据。
5. 如需要，点击「导出 CSV」。

限制：

- 只允许单条 `SELECT`。
- 后端默认限制 200 条，最大 1000 条。

### 4.3 单表查询

用途：按「条件列 = 条件值」查询一个返回列，适合快速查账号、UID、配置值。

步骤：

1. 打开「单表查询」Tab。
2. 点击「刷新表」或「加载表列表」。
3. 选择数据表。
4. 选择条件列，输入条件值。
5. 选择返回列。
6. 点击「查询」。

### 4.4 执行 SQL

用途：执行单条 DML/DDL，例如 `UPDATE`、`ALTER TABLE`。

步骤：

1. 打开「执行」Tab。
2. 输入 SQL。
3. 点击「执行语句」。
4. 浏览器弹窗确认后执行。

危险语句：

- `DELETE`
- `TRUNCATE`
- `DROP`

这些语句默认会被后端拦截。确实需要执行时，勾选「允许危险语句」，再确认弹窗。

### 4.5 导入 SQL 文件

用途：从后端本地目录读取 `.sql` 文件并流式导入，不经过浏览器上传。

准备文件：

1. 把 `.sql` 文件放到后端工作目录的 `data/` 目录。
2. 常见路径是 `backend/data/`。
3. 启动后端后，工作台会通过 `/api/mysql/sql-files` 扫描可用文件。

导入步骤：

1. 打开「导入 SQL 文件」Tab。
2. 点击「刷新」。
3. 在下拉框选择 SQL 文件。
4. 或在「自定义路径」填写路径。
5. 点击「开始导入」。
6. 确认弹窗后等待进度完成。

说明：

- 大文件由后端流式读取。
- 导入过程中可查看进度、速度、已执行语句数。
- 可点击「取消导入」请求取消。

### 4.6 批量导入

用途：为多个 MySQL 连接批量指定 SQL 文件并按顺序导入。

步骤：

1. 打开「批量导入」Tab。
2. 展开「分支与 SQL」。
3. 勾选要导入的连接。
4. 为每个连接选择 SQL 文件。
5. 点击「开始批量导入」。
6. 查看运行状态和导入历史。

适用场景：多个分支库需要导入同一份或不同 SQL dump。

### 4.7 清库

用途：删除当前 MySQL database 中的全部表。

当前连接清库：

1. 打开「清库」Tab。
2. 确认当前连接。
3. 点击「清空当前库」。
4. 确认弹窗后执行。

批量清库：

1. 打开「清库」Tab。
2. 展开「分支选择」。
3. 勾选需要清库的连接。
4. 点击「开始批量清库」。
5. 确认弹窗后执行。

这是高风险操作，不可恢复。

### 4.8 SQL 历史

工作台会记录查询/执行历史。

- 点击历史项可快速复用 SQL。
- 右键可切换收藏。
- 勾选「仅收藏」可过滤历史。

---

## 5. 更新信息模板怎么用

Popup 的「更新信息」Tab 用于生成固定格式的更新说明。

步骤：

1. 填写更新时间，或点击「当前时间」。
2. 填写客户端更新渠道。
3. 选择客户端配置/资源、客户端代码等字段。
4. 填写更新原因和补充信息。
5. 查看右侧/下方预览。
6. 点击复制按钮，将生成文本发到对应群或工单。

这个功能只在浏览器本地生成文本，不会写数据库。

---

## 6. 配置示例

### 6.1 Redis

```json
{
  "host": "127.0.0.1",
  "port": 6379,
  "password": null,
  "db": 0
}
```

### 6.2 MySQL

```json
{
  "host": "127.0.0.1",
  "port": 3306,
  "username": "root",
  "password": null,
  "database": "game"
}
```

### 6.3 本地化

```json
{
  "platform": "1",
  "group": "1",
  "server": "S1",
  "pre_login": "local_"
}
```

### 6.4 扩展完整配置结构

```json
{
  "settings": {
    "envs": {
      "dev": {
        "apiBase": "http://127.0.0.1:8642",
        "sourceRedis": {},
        "targetRedis": {},
        "mysql": {},
        "serverConfig": {},
        "defaultHashName": "Account",
        "defaultTables": ["Account"],
        "defaultDeleteKeys": []
      }
    },
    "mysqlConnections": []
  },
  "activeEnv": "dev"
}
```

---

## 7. 后端 API 附录

日常使用不需要手写 API，扩展会自动调用。调试时可参考以下路由。

### 7.1 健康检查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 后端存活检查 |

### 7.2 Redis

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/redis/ping` | Redis 路由 Ping |
| POST | `/api/redis/test` | Redis 连接测试 |
| POST | `/api/redis/flushdb` | 清空目标 DB |
| POST | `/api/redis/delete-keys` | 删除目标 Redis Keys |
| POST | `/api/redis/delete-tables` | 删除目标 Redis Tables/Keys |
| POST | `/api/redis/backup` | 源 Redis 备份到目标 Redis |
| POST | `/api/redis/hash/get` | 读取 Hash Field |
| POST | `/api/redis/hash/set` | 写入 Hash Field 原始 Base64 |
| POST | `/api/redis/hash/list` | 列出 Hash Fields |

### 7.3 MySQL

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/mysql/ping` | MySQL 路由 Ping |
| POST | `/api/mysql/test` | MySQL 连接测试 |
| POST | `/api/mysql/tables` | 表列表 |
| POST | `/api/mysql/columns` | 指定表列列表 |
| POST | `/api/mysql/lookup` | 单表单值查询 |
| POST | `/api/mysql/query` | SELECT 查询 |
| POST | `/api/mysql/execute` | 执行 DML/DDL |
| POST | `/api/mysql/flush-db` | 清空当前 database |
| GET | `/api/mysql/sql-files` | 扫描可导入 SQL 文件 |
| POST | `/api/mysql/import-file` | 启动 SQL 导入 |
| POST | `/api/mysql/import-file/status` | 查询导入进度 |
| POST | `/api/mysql/import-file/cancel` | 取消导入 |

### 7.4 账号本地化

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/process/localize-account` | 单账号本地化 |
| POST | `/api/process/localize-batch` | 指定 Field 列表本地化 |
| POST | `/api/process/localize-all-acc` | 全 Hash 本地化 |

### 7.5 确认码规则

危险操作必须传入准确的 `confirm_text`。扩展会自动生成并在弹窗中展示。

| 操作 | 确认码格式 |
| --- | --- |
| Redis 清库 | `FLUSHDB db=<db> host=<host>` |
| Redis 删除 Keys | `DELETE <count> db=<db>` |
| Redis 删除 Tables | `DELETE_TABLES <count> db=<db>` |
| MySQL 执行 | `EXECUTE mysql <host> db=<database>` |
| MySQL 危险执行 | `DANGEROUS EXECUTE mysql <host> db=<database>` |
| MySQL 清库 | `FLUSH mysql <host> db=<database>` |
| MySQL 导入 | `IMPORT mysql <host> db=<database> file=<文件名>` |

---

## 8. 打包与部署

### 8.1 macOS / Linux

```bash
chmod +x scripts/package/package-backend.sh
scripts/package/package-backend.sh
```

产物默认在 `dist/`。

### 8.2 Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package\package-backend.ps1
```

产物默认在 `dist/`。

### 8.3 内网离线编译包

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package\prepare-offline-build.ps1
```

离线编译包包含源码和 Rust crate vendor 依赖，但 Rust 工具链安装包需要单独准备。

---

## 9. 常见问题

**扩展连不上后端？**  
先确认 `cargo run` 正在运行，再执行 `curl http://127.0.0.1:8642/api/health`。如果端口改过，检查设置页 `API Base URL` 是否一致。

**后端健康检查成功，但接口失败？**  
检查 Redis/MySQL 的 host、port、db/database、账号密码。Docker 场景尤其要确认容器端口映射和 bind 地址。

**无密码怎么填？**  
密码框留空。保存后会按 `null` 处理。

**SQL 文件刷新不到？**  
确认 `.sql` 文件放在后端进程可访问的 `data/` 目录下，并确认后端已经启动。

**MySQL 查询为什么被拒绝？**  
查询入口只允许单条 `SELECT`。修改数据请去「执行」Tab。

**DELETE / DROP 为什么执行不了？**  
这类语句默认拦截。需要勾选「允许危险语句」，并确认弹窗。

**本地化失败或 skipped 很多？**  
先用「读取 Hash 字段并可视化」查看 Field 是否能解码为 MessagePack。非 MessagePack 数据不会被本地化。

**备份或全表本地化很慢？**  
大库/大 Hash 会耗时。建议先在小库验证，再在低峰期执行。

---

## 10. 开发检查

```bash
cd backend
cargo fmt --check
cargo check
cargo run
```

可选 Python 脚本：

```bash
python -m pip install redis msgpack
cd scripts/python/src
python cookredis.py
```

---

## License

见 [LICENSE](LICENSE)。
