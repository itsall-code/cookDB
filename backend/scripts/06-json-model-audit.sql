-- JSON 模型排查
-- 用法：检查活动、公会、玩法和玩家 JSON 模块是否有空数据、超大数据、软删除异常。

SELECT 'activity' AS table_name, creator_name, COUNT(*) AS row_count, SUM(deleted <> 0) AS deleted_count, ROUND(AVG(CHAR_LENGTH(JSON_UNQUOTE(json_data))), 1) AS avg_json_chars, MAX(CHAR_LENGTH(JSON_UNQUOTE(json_data))) AS max_json_chars, MAX(FROM_UNIXTIME(update_time)) AS latest_update_at FROM activity GROUP BY creator_name
UNION ALL SELECT 'guild', creator_name, COUNT(*), SUM(deleted <> 0), ROUND(AVG(CHAR_LENGTH(JSON_UNQUOTE(json_data))), 1), MAX(CHAR_LENGTH(JSON_UNQUOTE(json_data))), MAX(FROM_UNIXTIME(update_time)) FROM guild GROUP BY creator_name
UNION ALL SELECT 'play', creator_name, COUNT(*), SUM(deleted <> 0), ROUND(AVG(CHAR_LENGTH(JSON_UNQUOTE(json_data))), 1), MAX(CHAR_LENGTH(JSON_UNQUOTE(json_data))), MAX(FROM_UNIXTIME(update_time)) FROM play GROUP BY creator_name
UNION ALL SELECT 'player_basic', creator_name, COUNT(*), SUM(deleted <> 0), ROUND(AVG(CHAR_LENGTH(JSON_UNQUOTE(json_data))), 1), MAX(CHAR_LENGTH(JSON_UNQUOTE(json_data))), MAX(FROM_UNIXTIME(update_time)) FROM player_basic GROUP BY creator_name
UNION ALL SELECT 'player_bag', creator_name, COUNT(*), SUM(deleted <> 0), ROUND(AVG(CHAR_LENGTH(JSON_UNQUOTE(json_data))), 1), MAX(CHAR_LENGTH(JSON_UNQUOTE(json_data))), MAX(FROM_UNIXTIME(update_time)) FROM player_bag GROUP BY creator_name
UNION ALL SELECT 'player_hero', creator_name, COUNT(*), SUM(deleted <> 0), ROUND(AVG(CHAR_LENGTH(JSON_UNQUOTE(json_data))), 1), MAX(CHAR_LENGTH(JSON_UNQUOTE(json_data))), MAX(FROM_UNIXTIME(update_time)) FROM player_hero GROUP BY creator_name
ORDER BY table_name, row_count DESC;

SELECT 'activity' AS table_name, id, deleted, version, creator_name, CHAR_LENGTH(JSON_UNQUOTE(json_data)) AS json_chars, JSON_KEYS(json_data) AS json_keys, FROM_UNIXTIME(update_time) AS update_at FROM activity WHERE json_data IS NULL OR JSON_TYPE(json_data) IN ('NULL', 'BOOLEAN') OR CHAR_LENGTH(JSON_UNQUOTE(json_data)) < 5
UNION ALL SELECT 'guild', id, deleted, version, creator_name, CHAR_LENGTH(JSON_UNQUOTE(json_data)), JSON_KEYS(json_data), FROM_UNIXTIME(update_time) FROM guild WHERE json_data IS NULL OR JSON_TYPE(json_data) IN ('NULL', 'BOOLEAN') OR CHAR_LENGTH(JSON_UNQUOTE(json_data)) < 5
UNION ALL SELECT 'play', id, deleted, version, creator_name, CHAR_LENGTH(JSON_UNQUOTE(json_data)), JSON_KEYS(json_data), FROM_UNIXTIME(update_time) FROM play WHERE json_data IS NULL OR JSON_TYPE(json_data) IN ('NULL', 'BOOLEAN') OR CHAR_LENGTH(JSON_UNQUOTE(json_data)) < 5
UNION ALL SELECT 'player_basic', id, deleted, version, creator_name, CHAR_LENGTH(JSON_UNQUOTE(json_data)), JSON_KEYS(json_data), FROM_UNIXTIME(update_time) FROM player_basic WHERE json_data IS NULL OR JSON_TYPE(json_data) IN ('NULL', 'BOOLEAN') OR CHAR_LENGTH(JSON_UNQUOTE(json_data)) < 5
UNION ALL SELECT 'player_bag', id, deleted, version, creator_name, CHAR_LENGTH(JSON_UNQUOTE(json_data)), JSON_KEYS(json_data), FROM_UNIXTIME(update_time) FROM player_bag WHERE json_data IS NULL OR JSON_TYPE(json_data) IN ('NULL', 'BOOLEAN') OR CHAR_LENGTH(JSON_UNQUOTE(json_data)) < 5
UNION ALL SELECT 'player_hero', id, deleted, version, creator_name, CHAR_LENGTH(JSON_UNQUOTE(json_data)), JSON_KEYS(json_data), FROM_UNIXTIME(update_time) FROM player_hero WHERE json_data IS NULL OR JSON_TYPE(json_data) IN ('NULL', 'BOOLEAN') OR CHAR_LENGTH(JSON_UNQUOTE(json_data)) < 5
ORDER BY update_at DESC
LIMIT 200;

SELECT
  'activity' AS table_name,
  id,
  creator_name,
  CHAR_LENGTH(JSON_UNQUOTE(json_data)) AS json_chars,
  JSON_KEYS(json_data) AS json_keys,
  FROM_UNIXTIME(update_time) AS update_at
FROM activity
WHERE deleted = 0
ORDER BY json_chars DESC
LIMIT 50;

SELECT
  'player_basic' AS table_name,
  id,
  creator_name,
  CHAR_LENGTH(JSON_UNQUOTE(json_data)) AS json_chars,
  JSON_KEYS(json_data) AS json_keys,
  FROM_UNIXTIME(update_time) AS update_at
FROM player_basic
WHERE deleted = 0
ORDER BY json_chars DESC
LIMIT 50;
