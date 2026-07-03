-- 公会与玩法数据巡检
-- 适用：观察 guild/play 类 JSON 数据创建器、体积和更新时间。

SELECT
  creator_name,
  COUNT(*) AS guild_count,
  ROUND(AVG(CHAR_LENGTH(JSON_UNQUOTE(json_data))), 1) AS avg_json_chars,
  MAX(update_time) AS latest_update_time
FROM guild
WHERE deleted = 0
GROUP BY creator_name
ORDER BY guild_count DESC, creator_name
LIMIT 100;

SELECT
  id,
  creator_name,
  JSON_KEYS(json_data) AS model_keys,
  CHAR_LENGTH(JSON_UNQUOTE(json_data)) AS json_chars,
  update_time
FROM play
WHERE deleted = 0
ORDER BY update_time DESC, id DESC
LIMIT 80;
