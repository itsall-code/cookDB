-- 安全修数模板
-- 用法：先填 @account_id 或 @player_id 并运行查询确认命中；确认后再把 UPDATE 注释取消。

SET @account_id = _utf8mb4'替换为精确account.id' COLLATE utf8mb4_unicode_ci;
SET @player_id = 0;

SELECT
  a.id AS account_id,
  a.account,
  a.nick_name AS account_nick,
  a.player_id,
  a.deleted AS account_deleted,
  a.version AS account_version,
  FROM_UNIXTIME(a.update_time) AS account_update_at,
  pb.nick_name AS player_nick,
  pb.deleted AS player_deleted,
  pb.version AS player_version,
  FROM_UNIXTIME(pb.update_time) AS player_update_at
FROM account a
LEFT JOIN player_basic pb ON pb.id = a.player_id
WHERE a.id COLLATE utf8mb4_unicode_ci = @account_id COLLATE utf8mb4_unicode_ci
   OR (@player_id > 0 AND a.player_id = @player_id);

SELECT 'account' AS table_name, id, deleted, version, FROM_UNIXTIME(update_time) AS update_at FROM account WHERE id COLLATE utf8mb4_unicode_ci = @account_id COLLATE utf8mb4_unicode_ci OR (@player_id > 0 AND player_id = @player_id)
UNION ALL SELECT 'player_basic', CAST(id AS CHAR), deleted, version, FROM_UNIXTIME(update_time) FROM player_basic WHERE id = @player_id
UNION ALL SELECT 'player_bag', CAST(id AS CHAR), deleted, version, FROM_UNIXTIME(update_time) FROM player_bag WHERE id = @player_id
UNION ALL SELECT 'player_hero', CAST(id AS CHAR), deleted, version, FROM_UNIXTIME(update_time) FROM player_hero WHERE id = @player_id
UNION ALL SELECT 'player_play', CAST(id AS CHAR), deleted, version, FROM_UNIXTIME(update_time) FROM player_play WHERE id = @player_id;

-- UPDATE account
-- SET version = version + 1,
--     update_time = UNIX_TIMESTAMP()
-- WHERE id = @account_id
-- LIMIT 1;

-- UPDATE player_basic
-- SET version = version + 1,
--     update_time = UNIX_TIMESTAMP()
-- WHERE id = @player_id
-- LIMIT 1;
