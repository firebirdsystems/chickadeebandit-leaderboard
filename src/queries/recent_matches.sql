SELECT
  m.id         AS match_id,
  m.played_at,
  m.notes,
  c.name       AS category_name,
  c.icon       AS category_icon,
  p.member_id,
  p.team,
  p.result,
  p.rating_before,
  p.rating_after
FROM app_leaderboard__lb_matches m
JOIN app_leaderboard__lb_categories c
  ON c.id = m.category_id
JOIN app_leaderboard__lb_participants p
  ON p.match_id = m.id
ORDER BY m.played_at DESC
LIMIT 200
