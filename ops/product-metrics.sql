SELECT
  COUNT(DISTINCT CASE WHEN is_qa = 0 THEN session_hash END) AS users,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name IN ('searched','no_result') THEN session_hash END) AS searchers,
  COUNT(CASE WHEN is_qa = 0 AND event_name = 'searched' THEN 1 END) AS successful_searches,
  COUNT(CASE WHEN is_qa = 0 AND event_name = 'no_result' THEN 1 END) AS no_result_searches,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name = 'postal_opened' THEN session_hash END) AS postal_readers,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name IN ('postal_copied','address_copied') THEN session_hash END) AS copiers,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name = 'saved' THEN session_hash END) AS savers,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name = 'returned' THEN session_hash END) AS returned,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name IN ('searched','no_result') AND created_at >= unixepoch() - 7 * 86400 THEN session_hash END) AS searchers_7d,
  COUNT(DISTINCT CASE WHEN is_qa = 0 AND event_name IN ('postal_copied','address_copied') AND created_at >= unixepoch() - 7 * 86400 THEN session_hash END) AS copiers_7d,
  COUNT(CASE WHEN is_qa = 1 THEN 1 END) AS qa_rows
FROM product_events;

