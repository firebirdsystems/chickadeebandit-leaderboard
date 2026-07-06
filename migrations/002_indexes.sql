-- Indexes for hot filter/FK columns. Without these, category counts, category
-- detail views, and per-event dedup all fall back to full table scans, which
-- matters at the "organization" scale this app advertises (hundreds of matches).

CREATE INDEX IF NOT EXISTS app_leaderboard__idx_matches_category
  ON app_leaderboard__lb_matches (category_id);

CREATE INDEX IF NOT EXISTS app_leaderboard__idx_matches_source_event
  ON app_leaderboard__lb_matches (source_event_id);

CREATE INDEX IF NOT EXISTS app_leaderboard__idx_participants_match
  ON app_leaderboard__lb_participants (match_id);

CREATE INDEX IF NOT EXISTS app_leaderboard__idx_ratings_category
  ON app_leaderboard__lb_ratings (category_id);
