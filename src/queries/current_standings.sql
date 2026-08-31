SELECT
  r.member_id,
  r.rating,
  r.games_played,
  r.wins,
  r.losses,
  c.name AS category_name,
  c.icon AS category_icon,
  c.game_type
-- Categories is written FIRST and joined with a comma rather than JOIN ... ON.
-- Both details matter:
--
--   * The ordering leads on c.name, which lives on the categories side, so an
--     index can only supply it when categories is the OUTER loop. Written the
--     other way round the planner scans every rating row and sorts the lot in a
--     temp b-tree to return the first 200.
--   * CROSS JOIN would state that intent outright, but the hub's SQL parser
--     (node-sql-parser, sqlite dialect) cannot parse CROSS JOIN and rejects the
--     whole statement with "Could not parse SQL". A comma join is the strongest
--     form it accepts. This was shipped as a CROSS JOIN once and broke this
--     export in production - do not reintroduce it.
--
-- This is a planner preference, not a guarantee the way CROSS JOIN would be: the
-- comma operator does not forbid reordering, so a future ANALYZE could flip it
-- back to a scan. That degrades speed, never correctness.
--
-- Paired with app_leaderboard__lb_categories_name_idx.
FROM app_leaderboard__lb_categories c,
     app_leaderboard__lb_ratings r
WHERE r.category_id = c.id
  AND r.games_played > 0
ORDER BY c.name, r.rating DESC
LIMIT 200
