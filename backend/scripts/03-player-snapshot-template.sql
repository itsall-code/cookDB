-- 单玩家快照模板
-- 用法：把 @player_id 改成精确玩家 ID，用于处理“这个玩家哪里不对”。

SET @player_id = 0;

SELECT
  pb.id AS player_id,
  pb.account_id,
  a.account,
  a.server_id,
  a.pid,
  a.gid,
  pb.nick_name,
  pb.level,
  pb.battle_score,
  pb.max_battle_score,
  pb.inner_coin,
  pb.military_rank_id,
  pb.online_time,
  pb.today_online_time,
  pb.last_login_ip,
  FROM_UNIXTIME(pb.created_time) AS created_at,
  FROM_UNIXTIME(pb.last_login_time) AS last_login_at,
  FROM_UNIXTIME(pb.last_logout_time) AS last_logout_at,
  FROM_UNIXTIME(pb.update_time) AS player_update_at,
  pb.deleted AS player_deleted,
  a.deleted AS account_deleted
FROM player_basic pb
LEFT JOIN account a ON a.id = pb.account_id
WHERE pb.id = @player_id;

SELECT 'player_basic' AS module_name, id, deleted, version, FROM_UNIXTIME(update_time) AS update_at, creator_name, JSON_KEYS(json_data) AS json_keys FROM player_basic WHERE id = @player_id
UNION ALL SELECT 'player_bag', id, deleted, version, FROM_UNIXTIME(update_time), creator_name, JSON_KEYS(json_data) FROM player_bag WHERE id = @player_id
UNION ALL SELECT 'player_hero', id, deleted, version, FROM_UNIXTIME(update_time), creator_name, JSON_KEYS(json_data) FROM player_hero WHERE id = @player_id
UNION ALL SELECT 'player_develop', id, deleted, version, FROM_UNIXTIME(update_time), creator_name, JSON_KEYS(json_data) FROM player_develop WHERE id = @player_id
UNION ALL SELECT 'player_play', id, deleted, version, FROM_UNIXTIME(update_time), creator_name, JSON_KEYS(json_data) FROM player_play WHERE id = @player_id
UNION ALL SELECT 'player_quest', id, deleted, version, FROM_UNIXTIME(update_time), creator_name, JSON_KEYS(json_data) FROM player_quest WHERE id = @player_id
UNION ALL SELECT 'player_map', id, deleted, version, FROM_UNIXTIME(update_time), creator_name, JSON_KEYS(json_data) FROM player_map WHERE id = @player_id
ORDER BY update_at DESC;

SELECT
  pb.id AS player_id,
  pb.level,
  pb.battle_score AS basic_battle_score,
  dev.collection_battle_score,
  dev.equip_battle_score,
  dev.pet_battle_score,
  bag.military_honors,
  hero.total_hero_level,
  play_data.pass_tower,
  play_data.his_recruit_times,
  arena.score AS arena_score,
  duel.score AS doomsday_duel_score
FROM player_basic pb
LEFT JOIN player_develop dev ON dev.id = pb.id
LEFT JOIN player_bag bag ON bag.id = pb.id
LEFT JOIN player_hero hero ON hero.id = pb.id
LEFT JOIN player_play play_data ON play_data.id = pb.id
LEFT JOIN player_arena arena ON arena.id = pb.id
LEFT JOIN player_doomsday_duel duel ON duel.id = pb.id
WHERE pb.id = @player_id;

SELECT
  id AS order_id,
  state,
  recharge_id,
  recharge_money,
  rebate_coin,
  refund_diamond,
  real_rebate_money,
  d_type,
  FROM_UNIXTIME(update_time) AS update_at,
  deleted
FROM recharge_order
WHERE player_id = @player_id
ORDER BY update_time DESC
LIMIT 100;

SELECT
  id AS mail_id,
  deleted,
  version,
  OCTET_LENGTH(data) AS data_bytes,
  FROM_UNIXTIME(update_time) AS update_at
FROM player_mail
WHERE player_id = @player_id
ORDER BY update_time DESC
LIMIT 100;
