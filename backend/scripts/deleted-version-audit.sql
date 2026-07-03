-- 软删除与版本号巡检
-- 适用：检查常见业务表中 deleted/version/update_time 的数据质量。

SELECT 'account' AS table_name, COUNT(*) AS rows_total, SUM(deleted <> 0) AS rows_deleted, MAX(version) AS max_version, MAX(update_time) AS latest_update_time FROM account
UNION ALL
SELECT 'activity', COUNT(*), SUM(deleted <> 0), MAX(version), MAX(update_time) FROM activity
UNION ALL
SELECT 'guild', COUNT(*), SUM(deleted <> 0), MAX(version), MAX(update_time) FROM guild
UNION ALL
SELECT 'play', COUNT(*), SUM(deleted <> 0), MAX(version), MAX(update_time) FROM play
UNION ALL
SELECT 'play_server_region', COUNT(*), SUM(deleted <> 0), MAX(version), MAX(update_time) FROM play_server_region
ORDER BY rows_deleted DESC, table_name;

SELECT
  'account' AS table_name,
  id,
  deleted,
  version,
  update_time
FROM account
WHERE deleted <> 0 OR version <> 0
ORDER BY update_time DESC
LIMIT 50;
