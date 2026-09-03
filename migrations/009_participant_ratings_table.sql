-- The per-match rating movement, moved off lb_participants.
--
-- WHY IT MOVED. A participant row is evidence — who played, on which side, and
-- what happened — and until now any member could rewrite or delete another
-- member's, after the Elo fold had already read it. The fold does not re-run,
-- so the stored history drifted away from the ratings computed from it while
-- the match kept its original logged_by: the altered result stayed attributed
-- to whoever recorded it.
--
-- The modifier that fixes that is `frozen_when` with a parent reference: a
-- participant row is settled once the match it belongs to exists. It could not
-- be declared while `fold_participant_ratings` was an UPDATE against
-- lb_participants, because admission refuses any non-INSERT effect on a table
-- the manifest declares frozen (the effect lane runs without row policies, so
-- it would walk straight past the freeze).
--
-- Hence this table. The fold now INSERTS the movement here instead of UPDATING
-- lb_participants, which leaves lb_participants written once and never again —
-- free to be frozen by its match.
--
-- lb_participants.rating_before / rating_after stay behind as vestigial zeroes.
-- They are NOT NULL with no default so a client INSERT still has to name them,
-- and a migration may not remove a column at all (an older app version may
-- still read one), so they cannot go. Nothing reads them from this migration
-- onward; this table is the only answer to "what did that match do to my
-- rating".
--
-- The phrasing above is deliberate: build.mjs scans the RAW file, comments
-- included, for the statements a migration may not contain, so spelling that
-- prohibition out here would fail the build on its own explanation.
CREATE TABLE IF NOT EXISTS app_leaderboard__lb_participant_ratings (
  participant_id TEXT PRIMARY KEY,
  match_id       TEXT NOT NULL,
  member_id      TEXT NOT NULL,
  rating_before  REAL NOT NULL,
  rating_after   REAL NOT NULL
);

-- The read is always "the movements for these matches" — the category detail
-- view joins it to the 20 matches it just loaded.
CREATE INDEX IF NOT EXISTS app_leaderboard__lb_participant_ratings_match_idx
  ON app_leaderboard__lb_participant_ratings (match_id);

-- Carry the history across. Every value is copied from the participant row it
-- describes, so a replay lands on what the first run wrote, and the conflict
-- arm makes the second pass a no-op rather than an error — a migration file
-- replays from its first statement after a partial failure.
--
-- Runs after 008, so the rows it reads are the deduplicated ones: 008 removes
-- participant rows that duplicate an (match_id, member_id) pairing before the
-- UNIQUE index that forbids them goes on.
INSERT INTO app_leaderboard__lb_participant_ratings
  (participant_id, match_id, member_id, rating_before, rating_after)
SELECT p.id, p.match_id, p.member_id, p.rating_before, p.rating_after
  FROM app_leaderboard__lb_participants p
 WHERE EXISTS (SELECT 1 FROM app_leaderboard__lb_matches m WHERE m.id = p.match_id)
ON CONFLICT (participant_id) DO NOTHING;
