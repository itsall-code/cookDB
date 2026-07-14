# MySQL 排障脚本

路径：`cookDB/backend/scripts`

这些脚本面向游戏服排查，重点是账号定位、玩家模块完整性、订单、邮件、JSON 模型和二进制载荷异常。

- `00-triage-dashboard.sql`：排障入口，先看库、关键表更新时间、明显孤儿数据和缺失模块。
- `01-find-player-context-template.sql`：填账号、昵称、account id 或 player_id 片段，定位玩家上下文。
- `02-player-integrity-audit.sql`：扫描账号、玩家主表和玩家模块之间的不一致。
- `03-player-snapshot-template.sql`：填精确 `@player_id`，拉取一个玩家的核心状态快照。
- `04-payment-order-audit.sql`：订单、订阅、充值状态排查。
- `05-mail-audit.sql`：玩家邮件和全服邮件排查。
- `06-json-model-audit.sql`：JSON 模型体积、空数据、删除状态和创建器分布。
- `07-binary-payload-audit.sql`：BLOB 数据体积、缺失和异常样本。
- `safe-update-template.sql`：人工修数模板，默认只查询，确认后再取消 UPDATE 注释。
