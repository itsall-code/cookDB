-- 账号定位模板
-- 用法：把下面的 @keyword 改成 account、id、nick_name 或 player_id 片段。

SET @keyword = '镇邪人';

SELECT
  id,
  account,
  cid,
  player_id,
  nick_name,
  server_id,
  pid,
  gid,
  inner_account,
  create_ip,
  create_time,
  update_time
FROM account
WHERE id LIKE CONCAT('%', @keyword, '%')
   OR account LIKE CONCAT('%', @keyword, '%')
   OR nick_name LIKE CONCAT('%', @keyword, '%')
   OR CAST(player_id AS CHAR) LIKE CONCAT('%', @keyword, '%')
ORDER BY update_time DESC
LIMIT 100;
