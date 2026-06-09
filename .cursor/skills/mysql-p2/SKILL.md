---
name: mysql-p2
description: >-
  Implements Cook-Tools MySQL P2 features: Excel export, account data
  comparison, and batch UID SQL execution. Use when adding export, diff, or
  bulk operations to the cook-tools MySQL workbench.
---

# MySQL P2：导出 + 对比 + 批量执行

依赖 [mysql-p0](../mysql-p0/SKILL.md) 查询工作台；对比功能可与 [mysql-p1](../mysql-p1/SKILL.md) 快照复用。

## 9. Excel 导出

### 场景

- Bug 附件、数据验证、策划核对
- 导出 `player.xlsx`、`mail.xlsx`、`bag.xlsx`

### 实现选项

| 方案 | 说明 |
|------|------|
| A. 后端生成 | `rust_xlsxwriter`，`POST /api/mysql/export` 返回文件流 |
| B. 前端生成 | 扩展引入 SheetJS（`xlsx`），查询结果直接导出 |
| C. CSV 过渡 | P0 已有 CSV 可先满足部分需求 |

**推荐 A**：大数据量不堵扩展内存；复用已有 query 逻辑。

### API 草案

```rust
// POST /api/mysql/export
{
  "target": MySqlConfig,
  "sql": "SELECT * FROM player WHERE uid = 10001",
  "filename": "player.xlsx"
}
// Response: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
```

### UI

- 查询结果区「导出 Excel」按钮
- 模板库/联动查询结果也可导出

## 10. 数据对比

### 场景

对比账号 A vs 账号 B（或同一账号两个快照）。

### 输入

- `uid_a`、`uid_b`（或选择两条快照）
- 表/模块：`player`、`mail`、`bag`

### 输出

```text
gold:    10000 → 5000
diamond: 2000  → 3000
level:   35    → 40
```

### 实现

**后端**

```rust
// POST /api/mysql/compare
{
  "target": MySqlConfig,
  "table": "player",
  "key_column": "uid",
  "key_a": 10001,
  "key_b": 10002
}
```

- 查询两行 → 字段级 diff（忽略相同字段）
- 嵌套 JSON 列可展平或仅对比顶层

**或复用 P1 快照**：两条快照 JSON deep-diff。

### UI

- 双栏选择 UID / 快照
- 差异高亮（红/绿或箭头）

## 11. 批量执行

### 场景

```text
uid
10001
10002
10003
```

对每条执行：

```sql
UPDATE player SET gold = gold + 10000 WHERE uid = {uid}
```

### 实现

**后端**

```rust
// POST /api/mysql/batch-execute
{
  "target": MySqlConfig,
  "sql_template": "UPDATE player SET gold = gold + 10000 WHERE uid = ?",
  "uids": [10001, 10002, 10003],
  "confirm_text": "BATCH EXECUTE 3 uids mysql {host} db={database}"
}
```

- 事务包裹或逐条执行 + 汇总
- 返回 `{ succeeded: [], failed: [{ uid, error }] }`
- 遵守 P0 危险语句规则

**扩展**

- 文本框粘贴 UID 列表（每行一个）
- 或上传 `.txt` / `.csv`
- 进度条 + 失败明细

### 安全

- 批量上限（如 500）防误操作
- 必须确认码含 UID 数量
- 可选：执行前对第一个 UID 试跑 + 预览 affected

## 依赖

```toml
# backend/Cargo.toml
rust_xlsxwriter = "0.7"   # Excel
# diff 可用已有 serde_json + 递归比较，无需新 crate
```

## 验收清单

- [ ] 查询结果导出 `.xlsx` 可在 Excel/WPS 打开
- [ ] 两 UID 对比显示字段级差异
- [ ] 批量 UPDATE 正确处理成功/失败列表
- [ ] 批量 DELETE 受 P0 危险语句策略约束

## 参考

- [gap-analysis.md](../cook-tools/gap-analysis.md)
- [architecture.md](../cook-tools/architecture.md)
