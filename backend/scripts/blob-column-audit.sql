-- BLOB 字段体积巡检
-- 适用：检查 test.sql 中留言板、玩法区服等二进制列的大小分布。

SELECT
  'bbs_npc_message' AS table_name,
  COUNT(*) AS row_count,
  ROUND(AVG(OCTET_LENGTH(data)), 1) AS avg_bytes,
  MAX(OCTET_LENGTH(data)) AS max_bytes
FROM bbs_npc_message
UNION ALL
SELECT
  'play_server_region' AS table_name,
  COUNT(*) AS row_count,
  ROUND(AVG(OCTET_LENGTH(data)), 1) AS avg_bytes,
  MAX(OCTET_LENGTH(data)) AS max_bytes
FROM play_server_region
UNION ALL
SELECT
  'play_server_region_data' AS table_name,
  COUNT(*) AS row_count,
  ROUND(AVG(OCTET_LENGTH(data)), 1) AS avg_bytes,
  MAX(OCTET_LENGTH(data)) AS max_bytes
FROM play_server_region_data;

SELECT
  id,
  OCTET_LENGTH(data) AS data_bytes,
  update_time
FROM bbs_npc_message
ORDER BY data_bytes DESC
LIMIT 30;
