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
FROM lb_matches m
JOIN lb_categories c
  ON c.id           = m.category_id
  AND c.household_id = m.household_id
JOIN lb_participants p
  ON p.match_id = m.id
WHERE m.household_id = current_setting('app.household_id', true)::uuid
ORDER BY m.played_at DESC
LIMIT 200
