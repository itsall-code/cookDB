-- 排障入口面板
-- 用法：优先运行本脚本，快速确认当前库、数据更新时间、关键异常数量。

SELECT
  DATABASE() AS current_database,
  COUNT(*) AS table_count,
  ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS total_mb,
  MAX(update_time) AS latest_table_update
FROM information_schema.TABLES
WHERE table_schema = DATABASE();

SELECT 'account' AS table_name, COUNT(*) AS rows_total, SUM(deleted <> 0) AS deleted_rows, MAX(update_time) AS max_update_time, FROM_UNIXTIME(MAX(update_time)) AS max_update_at FROM account
UNION ALL SELECT 'player_basic', COUNT(*), SUM(deleted <> 0), MAX(update_time), FROM_UNIXTIME(MAX(update_time)) FROM player_basic
UNION ALL SELECT 'player_bag', COUNT(*), SUM(deleted <> 0), MAX(update_time), FROM_UNIXTIME(MAX(update_time)) FROM player_bag
UNION ALL SELECT 'player_hero', COUNT(*), SUM(deleted <> 0), MAX(update_time), FROM_UNIXTIME(MAX(update_time)) FROM player_hero
UNION ALL SELECT 'player_mail', COUNT(*), SUM(deleted <> 0), MAX(update_time), FROM_UNIXTIME(MAX(update_time)) FROM player_mail
UNION ALL SELECT 'recharge_order', COUNT(*), SUM(deleted <> 0), MAX(update_time), FROM_UNIXTIME(MAX(update_time)) FROM recharge_order
UNION ALL SELECT 'activity', COUNT(*), SUM(deleted <> 0), MAX(update_time), FROM_UNIXTIME(MAX(update_time)) FROM activity
ORDER BY max_update_time DESC, table_name;

SELECT 'account.player_id missing player_basic' AS check_item, COUNT(*) AS issue_count
FROM account a
LEFT JOIN player_basic pb ON pb.id = a.player_id
WHERE a.deleted = 0 AND a.player_id > 0 AND pb.id IS NULL
UNION ALL
SELECT 'player_basic missing account', COUNT(*)
FROM player_basic pb
LEFT JOIN account a ON a.id = pb.account_id
WHERE pb.deleted = 0 AND pb.account_id IS NOT NULL AND a.id IS NULL
UNION ALL
SELECT 'player_basic missing player_bag', COUNT(*)
FROM player_basic pb
LEFT JOIN player_bag bag ON bag.id = pb.id
WHERE pb.deleted = 0 AND bag.id IS NULL
UNION ALL
SELECT 'player_basic missing player_hero', COUNT(*)
FROM player_basic pb
LEFT JOIN player_hero hero ON hero.id = pb.id
WHERE pb.deleted = 0 AND hero.id IS NULL
UNION ALL
SELECT 'player_basic missing player_play', COUNT(*)
FROM player_basic pb
LEFT JOIN player_play play_data ON play_data.id = pb.id
WHERE pb.deleted = 0 AND play_data.id IS NULL
UNION ALL
SELECT 'orders without player_basic', COUNT(*)
FROM recharge_order ro
LEFT JOIN player_basic pb ON pb.id = ro.player_id
WHERE ro.deleted = 0 AND pb.id IS NULL;

SELECT
  id,
  account,
  nick_name,
  player_id,
  server_id,
  pid,
  gid,
  FROM_UNIXTIME(update_time) AS update_at
FROM account
WHERE deleted = 0
ORDER BY update_time DESC
LIMIT 20;
