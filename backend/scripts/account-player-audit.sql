-- 账号与玩家基础巡检
-- 适用：检查 account 表中的区服、渠道、内部号和创角绑定情况。

SELECT
  server_id,
  pid,
  gid,
  COUNT(*) AS account_count,
  SUM(inner_account = 1) AS inner_account_count,
  SUM(player_id > 0) AS bound_player_count,
  MIN(create_time) AS min_create_time,
  MAX(create_time) AS max_create_time
FROM account
GROUP BY server_id, pid, gid
ORDER BY account_count DESC
LIMIT 100;

SELECT
  id,
  account,
  player_id,
  nick_name,
  server_id,
  pid,
  gid,
  create_ip,
  create_time,
  update_time
FROM account
WHERE deleted = 0
ORDER BY update_time DESC
LIMIT 50;
