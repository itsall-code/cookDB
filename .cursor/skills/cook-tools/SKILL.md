---
name: cook-tools
description: >-
  Guides development of Cook-DB/Cook-Tools, a game testing database tool
  (Rust Axum backend + Chrome MV3 extension). Use when implementing MySQL
  features, Redis operations, extension UI, SQL tooling, or upgrading
  cook-redis toward the cook-tools roadmap in .cursor/skills/cook-tools/roadmap.md.
---

# Cook-Tools 项目开发

## 目标

将 cook-redis 升级为 **cook-tools**，面向游戏测试/联调：

| 模块 | 能力 |
|------|------|
| Redis | 查询/修改/删除 Key、Lua 执行 |
| MySQL | SQL 查询/执行、常用脚本、快照、对比、导出 |
| Protocol | 发协议、抓协议、重放协议（远期） |

需求见 [roadmap.md](roadmap.md)。分阶段实现见 `mysql-p0`、`mysql-p1`、`mysql-p2` skill。项目 rules 见 `.cursor/rules/`。

## 技术栈（实际，非 PRD 草案）

| 层 | 选型 |
|----|------|
| 后端 | Rust + Axum + sqlx (MySQL) + redis crate |
| 前端 | Chrome MV3 扩展，原生 HTML/CSS/JS |
| 配置 | `chrome.storage.local`（扩展）+ `backend/config/app.json`（监听地址） |

**不要**引入 PRD 中的 Vue/Electron/mysql2/TypeORM，除非用户明确要求重写架构。

## 目录结构

```text
backend/src/
  main.rs           # 路由合并入口
  routes/           # HTTP 路由（薄层）
  services/         # 业务逻辑
  models/           # 请求/响应/配置结构体
  error.rs          # AppError + ApiResponse
extension/
  popup.html/js     # 主操作面板
  options.html/js   # 多环境配置
  style.css
```

## 开发约定

### 后端

1. 路由在 `routes/*.rs`，业务在 `services/*.rs`，请求体在 `models/request.rs`。
2. 成功响应统一 `ApiResponse<T>`：`{ success, data, message }`。
3. 危险操作必须 `confirm_text` 严格匹配（参考 `FlushDbRequest`、`MySqlExecuteRequest`）。
4. MySQL 查询仅允许单条 `SELECT`；执行仅允许单条 mutation/DDL（见 `mysql_service.rs` 校验）。
5. 新增 API：加 route → service 函数 → request/response model → README 文档。

### 扩展

1. 环境配置存 `chrome.storage.local`，结构 `{ envs: { [name]: EnvConfig }, activeEnv }`。
2. `EnvConfig` 含 `apiBase`、`sourceRedis`、`targetRedis`、`mysql`、`serverConfig`。
3. API 调用走 `apiUrl(path)` + `fetch`，超时见 `DEFAULT_TIMEOUT` / `LONG_TIMEOUT`。
4. 新 UI 保持现有 `section` / `row` / `col` 样式，中文文案。

### 安全

- 后端 CORS 宽松，仅适合本地工具；不直接暴露公网。
- 执行 `FLUSHDB`、`DELETE`、`DROP` 等前必须二次确认。
- P0 要求默认禁止 `DELETE`/`TRUNCATE`/`DROP`，需显式解锁 + 确认。

## 实现新功能流程

```
Task Progress:
- [ ] 读 gap-analysis.md，确认当前缺口
- [ ] 后端：model → service → route
- [ ] 扩展：UI → fetch 调用 → 日志/错误展示
- [ ] cargo fmt && cargo check
- [ ] 更新 README API 段（如有新端点）
```

## 分阶段 Skill

| 阶段 | Skill | 内容 |
|------|-------|------|
| P0 | [mysql-p0](../mysql-p0/SKILL.md) | 连接管理、SQL 查询/执行、历史记录 |
| P1 | [mysql-p1](../mysql-p1/SKILL.md) | 游戏脚本中心、模板库、快照、Redis+MySQL 联动 |
| P2 | [mysql-p2](../mysql-p2/SKILL.md) | Excel 导出、数据对比、批量执行 |

## 参考文档

- 架构与现有 API：[architecture.md](architecture.md)
- 现状与目标差距：[gap-analysis.md](gap-analysis.md)
