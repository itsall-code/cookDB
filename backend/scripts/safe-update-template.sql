-- 安全更新模板
-- 用法：先运行 SELECT 确认命中范围，再取消 UPDATE 注释并替换 WHERE 条件。

SELECT
  id,
  deleted,
  update_time,
  version
FROM account
WHERE id = '请替换为精确账号ID'
LIMIT 20;

-- UPDATE account
-- SET version = version + 1,
--     update_time = UNIX_TIMESTAMP()
-- WHERE id = '请替换为精确账号ID'
-- LIMIT 1;
