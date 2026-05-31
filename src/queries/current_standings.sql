SELECT
  r.member_id,
  r.rating,
  r.games_played,
  r.wins,
  r.losses,
  c.name AS category_name,
  c.icon AS category_icon,
  c.game_type
FROM lb_ratings r
JOIN lb_categories c
  ON c.id           = r.category_id
  AND c.household_id = r.household_id
WHERE r.household_id = current_setting('app.household_id', true)::uuid
  AND r.games_played > 0
ORDER BY c.name, r.rating DESC
LIMIT 200
