CREATE TABLE IF NOT EXISTS lb_categories (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  icon         TEXT NOT NULL DEFAULT '🏆',
  game_type    TEXT NOT NULL DEFAULT '1v1',
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lb_matches (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  category_id  TEXT NOT NULL,
  played_at    TEXT NOT NULL,
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS lb_participants (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL,
  match_id      TEXT NOT NULL,
  member_id     TEXT NOT NULL,
  team          INTEGER NOT NULL,
  result        TEXT NOT NULL,
  rating_before REAL NOT NULL,
  rating_after  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS lb_ratings (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member_id    TEXT NOT NULL,
  category_id  TEXT NOT NULL,
  rating       REAL NOT NULL DEFAULT 1000,
  games_played INTEGER NOT NULL DEFAULT 0,
  wins         INTEGER NOT NULL DEFAULT 0,
  losses       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(household_id, member_id, category_id)
);
