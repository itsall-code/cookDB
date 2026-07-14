-- 支付/订单排查
-- 用法：@player_id = 0 时扫描全服；填具体玩家 ID 时只看该玩家。

SET @player_id = 0;

SELECT
  state,
  COUNT(*) AS order_count,
  SUM(recharge_money) AS total_recharge_money,
  SUM(rebate_coin) AS total_rebate_coin,
  SUM(refund_diamond) AS total_refund_diamond,
  MIN(FROM_UNIXTIME(update_time)) AS first_update_at,
  MAX(FROM_UNIXTIME(update_time)) AS last_update_at
FROM recharge_order
WHERE deleted = 0
  AND (@player_id = 0 OR player_id = @player_id)
GROUP BY state
ORDER BY order_count DESC;

SELECT
  ro.id AS order_id,
  ro.player_id,
  pb.nick_name,
  a.account,
  ro.state,
  ro.recharge_id,
  ro.recharge_money,
  ro.rebate_coin,
  ro.refund_diamond,
  ro.real_rebate_money,
  ro.d_type,
  FROM_UNIXTIME(ro.update_time) AS update_at
FROM recharge_order ro
LEFT JOIN player_basic pb ON pb.id = ro.player_id
LEFT JOIN account a ON a.id = pb.account_id
WHERE ro.deleted = 0
  AND (@player_id = 0 OR ro.player_id = @player_id)
  AND (pb.id IS NULL OR ro.recharge_money < 0 OR ro.rebate_coin < 0 OR ro.refund_diamond < 0)
ORDER BY ro.update_time DESC
LIMIT 100;

SELECT
  player_id,
  COUNT(*) AS order_count,
  COUNT(DISTINCT state) AS state_kinds,
  SUM(recharge_money) AS total_recharge_money,
  SUM(rebate_coin) AS total_rebate_coin,
  MAX(FROM_UNIXTIME(update_time)) AS last_order_at
FROM recharge_order
WHERE deleted = 0
  AND (@player_id = 0 OR player_id = @player_id)
GROUP BY player_id
ORDER BY total_recharge_money DESC, order_count DESC
LIMIT 100;

SELECT
  sub.id AS subscription_id,
  sub.player_id,
  pb.nick_name,
  sub.product_id,
  sub.order_id,
  sub.recharge_id,
  FROM_UNIXTIME(sub.expires_at) AS expires_at,
  FROM_UNIXTIME(sub.update_time) AS update_at,
  sub.ext,
  sub.deleted
FROM account_subscription sub
LEFT JOIN player_basic pb ON pb.id = sub.player_id
WHERE (@player_id = 0 OR sub.player_id = @player_id)
ORDER BY sub.update_time DESC
LIMIT 100;
