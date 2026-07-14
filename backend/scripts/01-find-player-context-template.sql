-- 账号/玩家定位模板
-- 用法：把 @keyword 改成 account、account.id、nick_name 或 player_id 的任意片段。

SET @keyword = _utf8mb4'替换为账号/昵称/player_id' COLLATE utf8mb4_unicode_ci;

SELECT
  a.id AS account_id,
  a.account,
  a.nick_name AS account_nick,
  a.player_id,
  a.last_login_player_id,
  a.server_id,
  a.pid,
  a.gid,
  a.inner_account,
  a.create_ip,
  FROM_UNIXTIME(a.create_time) AS account_create_at,
  FROM_UNIXTIME(a.update_time) AS account_update_at,
  pb.nick_name AS player_nick,
  pb.level,
  pb.battle_score,
  pb.max_battle_score,
  pb.last_login_ip,
  FROM_UNIXTIME(pb.last_login_time) AS last_login_at,
  FROM_UNIXTIME(pb.last_logout_time) AS last_logout_at
FROM account a
LEFT JOIN player_basic pb ON pb.id = a.player_id
WHERE a.id COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
   OR a.account COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
   OR a.nick_name COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
   OR CAST(a.player_id AS CHAR) COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
   OR CAST(a.last_login_player_id AS CHAR) COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
   OR pb.nick_name COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
ORDER BY a.update_time DESC
LIMIT 100;

SELECT
  pb.id AS player_id,
  pb.account_id,
  a.account,
  pb.nick_name,
  pb.level,
  pb.battle_score,
  pb.max_battle_score,
  pb.inner_coin,
  pb.city,
  pb.country,
  pb.last_login_ip,
  FROM_UNIXTIME(pb.created_time) AS created_at,
  FROM_UNIXTIME(pb.last_login_time) AS last_login_at,
  FROM_UNIXTIME(pb.last_logout_time) AS last_logout_at,
  FROM_UNIXTIME(pb.update_time) AS player_update_at
FROM player_basic pb
LEFT JOIN account a ON a.id = pb.account_id
WHERE CAST(pb.id AS CHAR) COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
   OR pb.account_id COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
   OR pb.nick_name COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
   OR a.account COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
ORDER BY pb.update_time DESC
LIMIT 100;

SELECT
  pb.id AS player_id,
  IF(bag.id IS NULL, 'missing', 'ok') AS bag_state,
  IF(hero.id IS NULL, 'missing', 'ok') AS hero_state,
  IF(dev.id IS NULL, 'missing', 'ok') AS develop_state,
  IF(play_data.id IS NULL, 'missing', 'ok') AS play_state,
  IF(quest.id IS NULL, 'missing', 'ok') AS quest_state,
  IF(map_data.id IS NULL, 'missing', 'ok') AS map_state,
  IF(arena.id IS NULL, 'missing', 'ok') AS arena_state,
  IF(recharge.id IS NULL, 'missing', 'ok') AS recharge_state
FROM player_basic pb
LEFT JOIN player_bag bag ON bag.id = pb.id
LEFT JOIN player_hero hero ON hero.id = pb.id
LEFT JOIN player_develop dev ON dev.id = pb.id
LEFT JOIN player_play play_data ON play_data.id = pb.id
LEFT JOIN player_quest quest ON quest.id = pb.id
LEFT JOIN player_map map_data ON map_data.id = pb.id
LEFT JOIN player_arena arena ON arena.id = pb.id
LEFT JOIN player_recharge recharge ON recharge.id = pb.id
WHERE CAST(pb.id AS CHAR) COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
   OR pb.account_id COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
   OR pb.nick_name COLLATE utf8mb4_unicode_ci LIKE CONCAT('%', @keyword, '%') COLLATE utf8mb4_unicode_ci
LIMIT 100;
