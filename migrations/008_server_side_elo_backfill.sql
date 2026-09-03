-- Ratings recomputed from the match history they are supposed to summarise.
--
-- From this release the Elo fold is `manifest.write_effects` on lb_matches:
-- when a match row lands, the hub appends two statements to the SAME
-- transaction — one filling each participant's rating_before/rating_after from
-- the ratings live at that moment, one folding those into lb_ratings — and
-- column_write_acls lock every one of those columns against clients. The
-- invariant the fold maintains from now on is exact:
--
--   lb_ratings.rating       = MAX(100, 1000 + SUM(rating_after - rating_before))
--   lb_ratings.games_played = COUNT(*)   over this member's rows in this category
--   lb_ratings.wins/losses  = COUNT(*)   of those whose result says so
--
-- The rows already in the database do NOT satisfy it. Ratings were computed in
-- the browser, one match at a time, and applied as deltas onto whatever the
-- row held: two matches processed concurrently both computed their movement
-- from the same stale base, and migration 003 folded away duplicate imports
-- whose inflation of the ratings it explicitly did not undo. Declaring an
-- effect is not retroactive — it fixes the next match, never the last one — so
-- the repair has to be a migration, and this is it.
--
-- Every value below is DERIVED from lb_participants, which this file does not
-- write, so running it twice lands on the same numbers as running it once —
-- the property migration 007 needed for the same reason (a migration file
-- replays from the top after a partial failure). It is the recompute the
-- effect performs, expressed over the whole history instead of one match; the
-- same statement 007 used to merge split categories, applied to every row.
--
-- It is not a true replay: each stored delta was computed against the base its
-- own client held, and the MAX(100, …) floor is applied once at the end rather
-- than per match. What it guarantees is that the rating and the counters beside
-- it finally agree with the matches on record, which is the state the fold
-- assumes when it computes the next one.
-- One participant row per member per match, enforced from here on.
--
-- `fold_ratings` adds exactly 1 to games_played for each participant row the
-- triggering match carries, so a member listed twice in one match counts twice
-- and takes the SECOND row's rating_after as their rating. Neither writer in
-- the app can produce that — both dedupe their roster, and isScorableGame()
-- requires distinct member ids — but nothing in the schema said so, and the
-- fold's arithmetic is only sound if something does.
--
-- The DELETE has to come first and in this same file: CREATE UNIQUE INDEX
-- against rows that already violate it fails, and a migration that fails is
-- one the app can never get past. Lowest rowid wins, which is the row the
-- writer inserted first. Both statements are replay-safe — the DELETE is
-- idempotent because it only ever removes rows that still have a lower-rowid
-- twin, and the index carries IF NOT EXISTS.
DELETE FROM app_leaderboard__lb_participants
 WHERE EXISTS (SELECT 1
         FROM app_leaderboard__lb_participants q
        WHERE q.match_id = app_leaderboard__lb_participants.match_id
          AND q.member_id = app_leaderboard__lb_participants.member_id
          AND q.rowid < app_leaderboard__lb_participants.rowid);

CREATE UNIQUE INDEX IF NOT EXISTS app_leaderboard__lb_participants_match_member_idx
  ON app_leaderboard__lb_participants (match_id, member_id);

-- The recompute runs AFTER the dedup above, so the counters it derives are
-- taken from the history the constraint now guarantees rather than from the
-- duplicates it just removed.
UPDATE app_leaderboard__lb_ratings
   SET rating = MAX(100, 1000 + IFNULL((SELECT SUM(p.rating_after - p.rating_before)
         FROM app_leaderboard__lb_participants p, app_leaderboard__lb_matches m
        WHERE m.id = p.match_id AND p.member_id = app_leaderboard__lb_ratings.member_id
          AND m.category_id = app_leaderboard__lb_ratings.category_id), 0)),
       games_played = (SELECT COUNT(*)
         FROM app_leaderboard__lb_participants p, app_leaderboard__lb_matches m
        WHERE m.id = p.match_id AND p.member_id = app_leaderboard__lb_ratings.member_id
          AND m.category_id = app_leaderboard__lb_ratings.category_id),
       wins = (SELECT COUNT(*)
         FROM app_leaderboard__lb_participants p, app_leaderboard__lb_matches m
        WHERE m.id = p.match_id AND p.member_id = app_leaderboard__lb_ratings.member_id
          AND m.category_id = app_leaderboard__lb_ratings.category_id AND p.result = 'win'),
       losses = (SELECT COUNT(*)
         FROM app_leaderboard__lb_participants p, app_leaderboard__lb_matches m
        WHERE m.id = p.match_id AND p.member_id = app_leaderboard__lb_ratings.member_id
          AND m.category_id = app_leaderboard__lb_ratings.category_id AND p.result = 'loss');

