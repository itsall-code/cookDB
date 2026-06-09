# Cook-Tools Cursor Skills

本目录为产品路线图对应的 Agent Skill 工程。持久化规则见 `.cursor/rules/`。

## 目录

```text
.cursor/
├── rules/                    # Cursor Rules（自动注入上下文）
│   ├── cook-tools.mdc        # 总览（alwaysApply）
│   ├── backend-rust.mdc      # 后端约定
│   ├── extension.mdc         # 扩展约定
│   └── mysql-roadmap.mdc     # MySQL 分阶段路线
└── skills/
    ├── cook-tools/
    │   ├── SKILL.md          # 主 Skill
    │   ├── roadmap.md        # 产品路线图（原 skills.md PRD）
    │   ├── architecture.md   # 现有 API
    │   └── gap-analysis.md   # 现状差距
    ├── mysql-p0/             # P0 实现指南
    ├── mysql-p1/             # P1 实现指南
    └── mysql-p2/             # P2 实现指南
```

## 使用方式

- **Rules**：编辑相关文件时自动生效（`cook-tools` 始终生效）
- **Skills**：实现具体阶段功能时加载 `mysql-p0` / `mysql-p1` / `mysql-p2`

## 实现顺序

1. **mysql-p0** — 连接管理 + SQL 工作台 + 历史
2. **mysql-p1** — 游戏脚本、模板、快照、UID 联动
3. **mysql-p2** — Excel 导出、对比、批量执行
