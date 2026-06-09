# 现状与目标差距

基于 [roadmap.md](roadmap.md) 与代码库扫描（2026-06）。

## 已完成

| 能力 | 状态 | 位置 |
|------|------|------|
| MySQL 连接测试 | ✅ | `/api/mysql/test`，扩展可测 MySQL |
| MySQL 表列表 | ✅ | `/api/mysql/tables` |
| MySQL SELECT 查询 | ✅ 仅 API | `/api/mysql/query`，**扩展无 SQL 面板** |
| MySQL 执行 | ✅ 仅 API | `/api/mysql/execute`，**扩展无执行 UI** |
| 单环境 MySQL 配置 | ✅ | `options.js` 每环境一组 mysql 字段 |
| Redis 全套操作 | ✅ | 扩展 popup 已覆盖 |
| 账号本地化 | ✅ | `/api/process/localize-*` |

## P0 缺口

| # | 需求 | 缺口 |
|---|------|------|
| 1 | 多连接管理（开发/测试/预发/本地） | 仅单 mysql 字段/环境，无命名连接 CRUD |
| 2 | SQL 查询 UI（分页/排序/复制/导出） | 无查询界面 |
| 3 | SQL 执行 UI + 危险语句限制 | 无 UI；后端**允许** DELETE/DROP/TRUNCATE |
| 4 | SQL 历史（1000 条 + 收藏） | 未实现 |

## P1 缺口

| # | 需求 | 缺口 |
|---|------|------|
| 5 | 游戏脚本中心（发钻石/金币/等级/体力） | 未实现 |
| 6 | SQL 模板库（参数替换） | 未实现 |
| 7 | 数据快照（修改前后 diff） | 未实现 |
| 8 | Redis + MySQL 联动（按 UID） | 未实现 |

## P2 缺口

| # | 需求 | 缺口 |
|---|------|------|
| 9 | Excel 导出 | 未实现 |
| 10 | 账号数据对比 | 未实现 |
| 11 | 批量 UID 执行 | 未实现 |

## 实现优先级建议

1. **P0-1** 扩展连接模型 → 再建 SQL 面板（面板需选连接）
2. **P0-2 + P0-3** SQL 工作台页面（查询 + 执行 Tab）
3. **P0-3** 后端加固：默认拒绝 DELETE/TRUNCATE/DROP，新增 `allow_dangerous: bool` 或分级 confirm
4. **P0-4** 历史记录先放扩展 `chrome.storage`（零后端改动）
5. P1/P2 按 skill 分步推进

## 命名演进

- 仓库名：`cook-redis` → 产品名趋向 **cook-tools** / **Cook-DB**
- 扩展标题仍为「Cook-DB 测试工具」，重命名需同步 `manifest.json`、README
