-- 活动 JSON 字段巡检
-- 适用：快速查看 activity 表 JSON 结构、活动创建器分布和字段大小。

SELECT
  creator_name,
  COUNT(*) AS activity_count,
  MIN(id) AS min_activity_id,
  MAX(id) AS max_activity_id,
  ROUND(AVG(CHAR_LENGTH(JSON_UNQUOTE(json_data))), 1) AS avg_json_chars
FROM activity
WHERE deleted = 0
GROUP BY creator_name
ORDER BY activity_count DESC, creator_name
LIMIT 100;

SELECT
  id,
  creator_name,
  JSON_KEYS(json_data) AS model_keys,
  CHAR_LENGTH(JSON_UNQUOTE(json_data)) AS json_chars,
  update_time
FROM activity
WHERE deleted = 0
ORDER BY update_time DESC, id DESC
LIMIT 50;
