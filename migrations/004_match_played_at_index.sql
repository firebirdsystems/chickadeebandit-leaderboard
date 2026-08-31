-- recent_matches orders by m.played_at DESC under LIMIT 200. Without an index on
-- played_at, SQLite drove the join from the participants table — scanning every
-- participant row of every match ever played — because nothing let it walk the
-- matches in the order the query asks for.
CREATE INDEX IF NOT EXISTS app_leaderboard__idx_matches_played_at
  ON app_leaderboard__lb_matches(played_at);
