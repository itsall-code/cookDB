-- BLOB/二进制载荷排查
-- 用法：定位邮件、离线包、图片、竞技场等二进制数据为空或过大的样本。

SELECT 'player_mail' AS table_name, COUNT(*) AS row_count, SUM(data IS NULL OR OCTET_LENGTH(data) = 0) AS empty_payloads, ROUND(AVG(OCTET_LENGTH(data)), 1) AS avg_bytes, MAX(OCTET_LENGTH(data)) AS max_bytes FROM player_mail
UNION ALL SELECT 'offline', COUNT(*), SUM(data IS NULL OR OCTET_LENGTH(data) = 0), ROUND(AVG(OCTET_LENGTH(data)), 1), MAX(OCTET_LENGTH(data)) FROM offline
UNION ALL SELECT 'player_image', COUNT(*), SUM(data IS NULL OR OCTET_LENGTH(data) = 0), ROUND(AVG(OCTET_LENGTH(data)), 1), MAX(OCTET_LENGTH(data)) FROM player_image
UNION ALL SELECT 'player_arena', COUNT(*), SUM(data IS NULL OR OCTET_LENGTH(data) = 0), ROUND(AVG(OCTET_LENGTH(data)), 1), MAX(OCTET_LENGTH(data)) FROM player_arena
UNION ALL SELECT 'player_doomsday_duel', COUNT(*), SUM(data IS NULL OR OCTET_LENGTH(data) = 0), ROUND(AVG(OCTET_LENGTH(data)), 1), MAX(OCTET_LENGTH(data)) FROM player_doomsday_duel
UNION ALL SELECT 'player_recharge', COUNT(*), SUM(data IS NULL OR OCTET_LENGTH(data) = 0), ROUND(AVG(OCTET_LENGTH(data)), 1), MAX(OCTET_LENGTH(data)) FROM player_recharge
UNION ALL SELECT 'play_server_region', COUNT(*), SUM(data IS NULL OR OCTET_LENGTH(data) = 0), ROUND(AVG(OCTET_LENGTH(data)), 1), MAX(OCTET_LENGTH(data)) FROM play_server_region
ORDER BY max_bytes DESC;

SELECT
  'player_mail' AS table_name,
  id,
  player_id AS owner_id,
  deleted,
  OCTET_LENGTH(data) AS data_bytes,
  FROM_UNIXTIME(update_time) AS update_at
FROM player_mail
WHERE data IS NULL OR OCTET_LENGTH(data) = 0 OR OCTET_LENGTH(data) > 65535
UNION ALL
SELECT 'offline', id, id, deleted, OCTET_LENGTH(data), FROM_UNIXTIME(update_time)
FROM offline
WHERE data IS NULL OR OCTET_LENGTH(data) = 0 OR OCTET_LENGTH(data) > 65535
UNION ALL
SELECT 'player_image', id, player_id, deleted, OCTET_LENGTH(data), FROM_UNIXTIME(update_time)
FROM player_image
WHERE data IS NULL OR OCTET_LENGTH(data) = 0 OR OCTET_LENGTH(data) > 65535
ORDER BY data_bytes DESC, update_at DESC
LIMIT 200;

SELECT
  pi.player_id,
  pb.nick_name,
  COUNT(*) AS image_count,
  ROUND(AVG(OCTET_LENGTH(pi.data)), 1) AS avg_image_bytes,
  MAX(OCTET_LENGTH(pi.data)) AS max_image_bytes,
  MAX(FROM_UNIXTIME(pi.update_time)) AS last_update_at
FROM player_image pi
LEFT JOIN player_basic pb ON pb.id = pi.player_id
GROUP BY pi.player_id, pb.nick_name
ORDER BY image_count DESC, max_image_bytes DESC
LIMIT 100;
