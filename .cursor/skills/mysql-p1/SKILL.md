---
name: mysql-p1
description: >-
  Implements Cook-Tools MySQL P1 features: game script center, SQL template
  library, data snapshots with diff, and Redis+MySQL unified UID lookup.
  Use after mysql-p0 is complete, or when building game testing automation UI.
---

# MySQL P1：脚本中心 + 快照 + 联动查询

依赖 [mysql-p0](../mysql-p0/SKILL.md) 的 SQL 工作台与连接管理。

## 5. 游戏脚本中心

### 内置脚本

| 脚本 | SQL 模板 |
|------|----------|
| 发钻石 | `UPDATE player SET diamond = diamond + ? WHERE uid = ?` |
| 发金币 | `UPDATE player SET gold = gold + ? WHERE uid = ?` |
| 修改等级 | `UPDATE player SET level = ? WHERE uid = ?` |
| 重置体力 | `UPDATE player SET stamina = max_stamina WHERE uid = ?` |

### UI

- 卡片列表，每张卡片：参数表单 + 执行按钮
- 参数：`uid`（必填）、数值字段（钻石/金币/等级）
- 执行走 `/api/mysql/execute`（参数化，禁止字符串拼接 uid）

### 实现

**后端（推荐）**

```rust
// POST /api/mysql/script/execute
{
  "target": MySqlConfig,
  "script_id": "grant_diamond",
  "params": { "uid": 10001, "amount": 10000 },
  "confirm_text": "..."
}
```

- 服务端维护 `script_id → 预编译 SQL + 参数槽位` 白名单
- 扩展只传 script_id + params，不传原始 SQL

**或扩展侧**：脚本定义存 `chrome.storage`，仍调用 execute（快但安全性弱）。

## 6. SQL 模板库

### 内置模板

| 名称 | 模板 |
|------|------|
| 查角色 | `SELECT * FROM player WHERE uid = {uid}` |
| 查邮件 | `SELECT * FROM mail WHERE uid = {uid}` |
| 查背包 | `SELECT * FROM bag_item WHERE uid = {uid}` |

### 能力

- `{uid}` 等占位符 → 表单输入 → 替换后执行
- 用户可新增/编辑/删除自定义模板（存 `chrome.storage`）
- 一键执行：替换 → 查询 Tab 执行

### 安全

- 占位符仅允许 `\{[a-zA-Z_][a-zA-Z0-9_]*\}` 
- 替换值做数字/字符串转义；uid 默认仅数字

## 7. 数据快照

### 流程

1. 执行 mutation 前，对关联 SELECT 拍快照
2. mutation 后再拍快照
3. 对比展示 diff

### 快照结构

```json
{
  "id": "snap-uuid",
  "uid": 10001,
  "table": "player",
  "capturedAt": 1717843200000,
  "data": { "uid": 10001, "level": 35, "gold": 10000 }
}
```

### Diff 展示

```text
level: 35 → 36
gold:  10000 → 5000
```

### 实现

- 扩展：mutation 前自动 `SELECT * FROM player WHERE uid=?` 存本地
- 或后端 `POST /api/mysql/snapshot` 封装查询+存储（SQLite 文件 `backend/data/snapshots.db`）
- UI：快照列表 + 选择两条对比

## 8. Redis + MySQL 联动

### 输入

`UID = 10001`

### 自动查询

| 源 | Key/表 |
|----|--------|
| Redis | `player_cache`, `mail_cache`, `bag_cache`（Hash 字段 = uid 或约定 key） |
| MySQL | `player`, `mail`, `bag_item` |

### 实现

**后端**

```rust
// POST /api/lookup/uid
{
  "uid": 10001,
  "redis": RedisConfig,
  "mysql": MySqlConfig,
  "profile": "default"  // 映射表名/Hash 名
}
```

- `profile` 配置各游戏项目的表名/缓存 key 映射
- 并行查询 Redis hash/get + MySQL SELECT
- 返回统一 JSON 树

**扩展**

- 单输入框 + 查询按钮
- 分区展示 Redis / MySQL 结果（可折叠 JSON 树）

### 映射配置示例

```json
{
  "redis": {
    "player": { "type": "hash", "name": "player_cache", "field": "{uid}" },
    "mail": { "type": "hash", "name": "mail_cache", "field": "{uid}" }
  },
  "mysql": {
    "player": "SELECT * FROM player WHERE uid = ?",
    "mail": "SELECT * FROM mail WHERE uid = ?"
  }
}
```

## 验收清单

- [ ] 四个游戏脚本可参数化执行
- [ ] 模板库支持内置 + 自定义，参数替换正确
- [ ] 快照可保存、可 diff
- [ ] UID 联动一次返回 Redis + MySQL 数据

## 参考

- Redis Hash API：[architecture.md](../cook-tools/architecture.md)
- P0 工作台：[mysql-p0/SKILL.md](../mysql-p0/SKILL.md)
