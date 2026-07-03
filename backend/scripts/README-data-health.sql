-- 数据库概览与表体积巡检
-- 适用：导入 backend/data/test.sql 后，快速确认表数量、行数估算和占用空间。

SELECT
  DATABASE() AS current_database,
  COUNT(*) AS table_count,
  ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS total_mb
FROM information_schema.TABLES
WHERE table_schema = DATABASE();

SELECT
  table_name,
  table_rows AS estimated_rows,
  ROUND(data_length / 1024 / 1024, 2) AS data_mb,
  ROUND(index_length / 1024 / 1024, 2) AS index_mb,
  ROUND((data_length + index_length) / 1024 / 1024, 2) AS total_mb,
  update_time
FROM information_schema.TABLES
WHERE table_schema = DATABASE()
ORDER BY (data_length + index_length) DESC, table_rows DESC
LIMIT 30;
