# Cook-Tools 产品路线图

将 cook-redis 升级为 **cook-tools**，面向游戏测试/联调。

## 模块规划

```text
cook-tools
├── Redis    查询/修改/删除 Key、Lua 执行
├── MySQL    SQL 查询/执行、常用脚本、快照、对比、导出
└── Protocol 发协议、抓协议、重放协议（远期）
```

## P0：MySQL 基础

### 1. 多数据库连接管理

环境：开发服、测试服、预发服、本地服。

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

功能：新增、编辑、删除、测试连接。

### 2. SQL 查询

- 执行 `SELECT`，表格展示结果
- 分页、排序、复制单元格、导出 Excel（完整导出见 P2）

### 3. SQL 执行

- 支持 `UPDATE` 等 mutation
- `DELETE` / `TRUNCATE` / `DROP` 默认禁止，需二次确认

### 4. SQL 历史

- 最近 1000 条，支持收藏与快速执行

## P1：测试效率

### 5. 游戏脚本中心

| 脚本 | SQL |
|------|-----|
| 发钻石 | `UPDATE player SET diamond=diamond+? WHERE uid=?` |
| 发金币 | `UPDATE player SET gold=gold+? WHERE uid=?` |
| 修改等级 | `UPDATE player SET level=? WHERE uid=?` |
| 重置体力 | `UPDATE player SET stamina=max_stamina WHERE uid=?` |

### 6. SQL 模板库

查角色 / 查邮件 / 查背包，支持 `{uid}` 参数替换与一键执行。

### 7. 数据快照

修改前后自动保存行数据，展示字段 diff（如 `level: 35 → 36`）。

### 8. Redis + MySQL 联动

输入 UID，并行查询 Redis 缓存与 MySQL 表，统一展示。

## P2：导出与批量

### 9. Excel 导出

`player.xlsx`、`mail.xlsx`、`bag.xlsx`，用于 Bug 附件与策划核对。

### 10. 数据对比

账号 A vs 账号 B，字段级差异输出。

### 11. 批量执行

导入 UID 列表，对模板 SQL 自动批量处理。

## 技术栈（本项目实际）

| 层 | 选型 |
|----|------|
| 后端 | Rust + Axum + sqlx |
| 前端 | Chrome MV3 扩展（原生 JS） |
| Excel | `rust_xlsxwriter`（后端）或扩展 SheetJS |
| SQL 格式化 | `sqlformat`（Rust） |

不使用 Vue/Electron/mysql2/TypeORM，除非明确要求重写架构。
