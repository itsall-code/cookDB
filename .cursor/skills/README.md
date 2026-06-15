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
    ├── mysql-p2/             # P2 实现指南
    ├── fd/                   # 前端视觉设计（差异化 UI）
    ├── ui-ux-pro-max/        # UI/UX 设计系统检索（配色、字体、组件规范）
    └── kami/                 # 文档排版 / PDF / 落地页（→ .agents/skills/kami）
```

## 使用方式

- **Rules**：编辑相关文件时自动生效（`cook-tools` 始终生效）
- **Skills**：实现具体阶段功能时加载 `mysql-p0` / `mysql-p1` / `mysql-p2`；做界面优化时加载 `fd` / `ui-ux-pro-max`；做文档排版 / PDF / 落地页时加载 `kami`

## 外部 Skill：Kami

[Kami](https://github.com/tw93/Kami)（紙）是专业文档排版 skill，支持简历、一页纸、白皮书、信件、作品集、幻灯片、落地页等 9 种模板。

安装位置：`.cursor/skills/kami/`（junction → `.agents/skills/kami/`，由 `npx skills add tw93/kami -a cursor -y` 安装）

```bash
# 更新
npx skills update kami -y

# 可选：品牌配置
# 创建 ~/.config/kami/brand.md 持久化个人风格
```

示例提示词：`帮我做一份一页纸` / `build me a resume` / `帮我做一个产品落地页`

## 实现顺序

1. **mysql-p0** — 连接管理 + SQL 工作台 + 历史
2. **mysql-p1** — 游戏脚本、模板、快照、UID 联动
3. **mysql-p2** — Excel 导出、对比、批量执行
