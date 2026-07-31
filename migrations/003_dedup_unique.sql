-- source_event_id is the dedup guard for game.completed ingestion, but it was
-- only a plain index, and the guard itself is a SELECT followed by an INSERT
-- from the CLIENT — processGameEvents() runs in every member's browser on app
-- load. Two tabs (or two members opening the app at the same moment) both saw
-- no row, both inserted, and the same match was folded into the Elo ratings
-- twice. The sibling apps that consume the same event stream already key on the
-- event id in the schema: piggy-bank's processed_events and
-- rewards-privileges' points_ledger both make it the PRIMARY KEY.
--
-- Fold any duplicates that already landed before making the constraint real:
-- keep the earliest row per source_event_id, drop the rest with their
-- participants. The ratings those extra rows inflated are not recomputed here
-- (the app has no replay path) — this only stops the double-counting from
-- continuing.
DELETE FROM app_leaderboard__lb_participants
WHERE match_id IN (
  SELECT m.id FROM app_leaderboard__lb_matches m
  WHERE m.source_event_id IS NOT NULL
    AND m.rowid > (
      SELECT MIN(m2.rowid) FROM app_leaderboard__lb_matches m2
      WHERE m2.source_event_id = m.source_event_id
    )
);

DELETE FROM app_leaderboard__lb_matches
WHERE source_event_id IS NOT NULL
  AND rowid > (
    SELECT MIN(m2.rowid) FROM app_leaderboard__lb_matches m2
    WHERE m2.source_event_id = app_leaderboard__lb_matches.source_event_id
  );

-- NULL source_event_id (manually recorded matches) repeats freely: SQLite
-- treats NULLs as distinct in a UNIQUE index, which is exactly what is wanted.
DROP INDEX IF EXISTS app_leaderboard__idx_matches_source_event;

CREATE UNIQUE INDEX IF NOT EXISTS app_leaderboard__idx_matches_source_event_unique
  ON app_leaderboard__lb_matches (source_event_id);
