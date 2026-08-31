SELECT
  r.member_id,
  r.rating,
  r.games_played,
  r.wins,
  r.losses,
  c.name AS category_name,
  c.icon AS category_icon,
  c.game_type
-- CROSS JOIN is deliberate and is NOT a cartesian product: the ON clause still
-- applies, and in SQLite the only difference from JOIN is that the planner may
-- not reorder the tables. That is exactly what this needs. The ordering leads on
-- c.name, which lives on the categories side, so an index can only supply it if
-- categories is the OUTER loop. Left as a plain JOIN the planner scanned every
-- rating row and sorted the lot in a temp b-tree to return the first 200.
--
-- Paired with app_leaderboard__lb_categories_name_idx, which supplies c.name in
-- order. Write the tables in this order or the hint does nothing.
FROM app_leaderboard__lb_categories c
CROSS JOIN app_leaderboard__lb_ratings r
  ON r.category_id = c.id
WHERE r.games_played > 0
ORDER BY c.name, r.rating DESC
LIMIT 200
