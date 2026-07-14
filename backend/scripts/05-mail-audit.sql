-- 邮件排查
-- 用法：@player_id = 0 时看全服异常；填具体玩家 ID 时看该玩家邮件。

SET @player_id = 0;

SELECT
  pm.player_id,
  pb.nick_name,
  a.account,
  COUNT(*) AS mail_count,
  SUM(pm.deleted <> 0) AS deleted_count,
  ROUND(AVG(OCTET_LENGTH(pm.data)), 1) AS avg_bytes,
  MAX(OCTET_LENGTH(pm.data)) AS max_bytes,
  MAX(FROM_UNIXTIME(pm.update_time)) AS last_mail_update_at
FROM player_mail pm
LEFT JOIN player_basic pb ON pb.id = pm.player_id
LEFT JOIN account a ON a.id = pb.account_id
WHERE (@player_id = 0 OR pm.player_id = @player_id)
GROUP BY pm.player_id, pb.nick_name, a.account
ORDER BY mail_count DESC, max_bytes DESC
LIMIT 100;

SELECT
  pm.id AS mail_id,
  pm.player_id,
  pb.nick_name,
  pm.deleted,
  pm.version,
  OCTET_LENGTH(pm.data) AS data_bytes,
  FROM_UNIXTIME(pm.update_time) AS update_at
FROM player_mail pm
LEFT JOIN player_basic pb ON pb.id = pm.player_id
WHERE (@player_id = 0 OR pm.player_id = @player_id)
ORDER BY pm.update_time DESC
LIMIT 200;

SELECT
  pm.id AS mail_id,
  pm.player_id,
  OCTET_LENGTH(pm.data) AS data_bytes,
  FROM_UNIXTIME(pm.update_time) AS update_at,
  CASE
    WHEN pb.id IS NULL THEN 'missing player_basic'
    WHEN pm.data IS NULL THEN 'null mail payload'
    WHEN OCTET_LENGTH(pm.data) = 0 THEN 'empty mail payload'
    ELSE 'large mail payload'
  END AS issue_type
FROM player_mail pm
LEFT JOIN player_basic pb ON pb.id = pm.player_id
WHERE (@player_id = 0 OR pm.player_id = @player_id)
  AND (pb.id IS NULL OR pm.data IS NULL OR OCTET_LENGTH(pm.data) = 0 OR OCTET_LENGTH(pm.data) > 65535)
ORDER BY pm.update_time DESC
LIMIT 100;

SELECT
  id AS server_mail_id,
  deleted,
  version,
  OCTET_LENGTH(data) AS data_bytes,
  FROM_UNIXTIME(update_time) AS update_at
FROM server_mail
ORDER BY update_time DESC
LIMIT 100;
