-- 玩家完整性巡检
-- 用法：排查登录失败、创角异常、数据回档、模块缺失时运行。

SELECT
  a.id AS account_id,
  a.account,
  a.nick_name,
  a.player_id,
  a.last_login_player_id,
  a.server_id,
  a.pid,
  a.gid,
  FROM_UNIXTIME(a.update_time) AS account_update_at
FROM account a
LEFT JOIN player_basic pb ON pb.id = a.player_id
WHERE a.deleted = 0
  AND a.player_id > 0
  AND pb.id IS NULL
ORDER BY a.update_time DESC
LIMIT 100;

SELECT
  pb.id AS player_id,
  pb.account_id,
  pb.nick_name,
  pb.level,
  pb.battle_score,
  FROM_UNIXTIME(pb.update_time) AS player_update_at
FROM player_basic pb
LEFT JOIN account a ON a.id = pb.account_id
WHERE pb.deleted = 0
  AND pb.account_id IS NOT NULL
  AND a.id IS NULL
ORDER BY pb.update_time DESC
LIMIT 100;

SELECT
  pb.id AS player_id,
  pb.account_id,
  pb.nick_name,
  CONCAT_WS(',',
    IF(bag.id IS NULL, 'bag', NULL),
    IF(hero.id IS NULL, 'hero', NULL),
    IF(dev.id IS NULL, 'develop', NULL),
    IF(play_data.id IS NULL, 'play', NULL),
    IF(quest.id IS NULL, 'quest', NULL),
    IF(map_data.id IS NULL, 'map', NULL)
  ) AS missing_modules,
  FROM_UNIXTIME(pb.update_time) AS player_update_at
FROM player_basic pb
LEFT JOIN player_bag bag ON bag.id = pb.id
LEFT JOIN player_hero hero ON hero.id = pb.id
LEFT JOIN player_develop dev ON dev.id = pb.id
LEFT JOIN player_play play_data ON play_data.id = pb.id
LEFT JOIN player_quest quest ON quest.id = pb.id
LEFT JOIN player_map map_data ON map_data.id = pb.id
WHERE pb.deleted = 0
  AND (bag.id IS NULL OR hero.id IS NULL OR dev.id IS NULL OR play_data.id IS NULL OR quest.id IS NULL OR map_data.id IS NULL)
ORDER BY pb.update_time DESC
LIMIT 100;

SELECT
  account,
  COUNT(*) AS duplicate_count,
  GROUP_CONCAT(id ORDER BY update_time DESC SEPARATOR ', ') AS account_ids,
  GROUP_CONCAT(player_id ORDER BY update_time DESC SEPARATOR ', ') AS player_ids
FROM account
WHERE deleted = 0 AND account IS NOT NULL AND account <> ''
GROUP BY account
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, account
LIMIT 100;

SELECT
  nick_name,
  COUNT(*) AS duplicate_count,
  GROUP_CONCAT(id ORDER BY update_time DESC SEPARATOR ', ') AS player_ids
FROM player_basic
WHERE deleted = 0 AND nick_name IS NOT NULL AND nick_name <> ''
GROUP BY nick_name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, nick_name
LIMIT 100;
