SELECT
  r.member_id,
  r.rating,
  r.games_played,
  r.wins,
  r.losses,
  c.name AS category_name,
  c.icon AS category_icon,
  c.game_type
FROM app_leaderboard__lb_ratings r
JOIN app_leaderboard__lb_categories c
  ON c.id = r.category_id
WHERE r.games_played > 0
ORDER BY c.name, r.rating DESC
LIMIT 200
