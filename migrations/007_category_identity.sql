-- Category identity, enforced by the database rather than by a race.
--
-- A category is (name, game_type): game_type decides how results fold into
-- ratings, so "Ping Pong" as 1v1 and as ranked are different scoring histories
-- that must not merge. ensureCategory() looks a category up and inserts it if
-- absent, and every open client ingests events — so two clients handling the
-- first two events for a new category both find nothing and both insert. The
-- create-category UI never checked either. The duplicate splits the category's
-- history in half at its first match, when nobody would notice.
--
-- A UNIQUE index makes the second insert lose instead, so the app can use
-- ON CONFLICT DO NOTHING and read back the single winner. Both columns are
-- stored as written (`db_encryption: "off"`), so the index sees real values; a
-- UNIQUE over an encrypted column would be dead, admitting every duplicate.
--
-- BUT THE CONSTRAINT CANNOT BE ADDED ALONE. Households that ran the earlier
-- versions already hold duplicates, and CREATE UNIQUE INDEX against them fails
-- — every time, forever. The version is recorded only after the last statement,
-- so such a household retries this file on every update attempt and never gets
-- past it: the app is stuck on its previous version with no operator action
-- available. The fold below is what makes the constraint reachable. (Its own
-- file, rather than 006's, only because a migration's sql caps at 8000 chars.)
--
-- Survivor = the lowest-rowid category in each (name, game_type) group, i.e.
-- the one created first. Every statement below is a NO-OP once it has run,
-- because a failure part-way replays this file from the top.

-- Matches move to the survivor, so the merged category shows one whole history.
-- `<>` against a NULL survivor (a match whose category is already gone) is
-- NULL, so those rows are left alone rather than nulled out.
UPDATE app_leaderboard__lb_matches
   SET category_id = (SELECT peer.id
         FROM app_leaderboard__lb_categories peer, app_leaderboard__lb_categories self
        WHERE self.id = app_leaderboard__lb_matches.category_id
          AND peer.name = self.name AND peer.game_type = self.game_type
        ORDER BY peer.rowid LIMIT 1)
 WHERE category_id <> (SELECT peer.id
         FROM app_leaderboard__lb_categories peer, app_leaderboard__lb_categories self
        WHERE self.id = app_leaderboard__lb_matches.category_id
          AND peer.name = self.name AND peer.game_type = self.game_type
        ORDER BY peer.rowid LIMIT 1);

-- Ratings cannot simply be repointed: lb_ratings is UNIQUE (member_id,
-- category_id), so a member holding a rating in both halves of a split category
-- would collide. Give every such member a survivor row first — OR IGNORE makes
-- that a no-op when they already have one, and when two duplicates name the
-- same survivor. The placeholder values are overwritten below; they exist only
-- so the merge has somewhere to land.
INSERT OR IGNORE INTO app_leaderboard__lb_ratings
  (id, member_id, category_id, rating, games_played, wins, losses)
SELECT lower(hex(randomblob(16))), r.member_id,
       (SELECT peer.id
          FROM app_leaderboard__lb_categories peer, app_leaderboard__lb_categories self
         WHERE self.id = r.category_id AND peer.name = self.name AND peer.game_type = self.game_type
         ORDER BY peer.rowid LIMIT 1),
       1000, 0, 0, 0
  FROM app_leaderboard__lb_ratings r
 WHERE r.category_id <> (SELECT peer.id
         FROM app_leaderboard__lb_categories peer, app_leaderboard__lb_categories self
        WHERE self.id = r.category_id AND peer.name = self.name AND peer.game_type = self.game_type
        ORDER BY peer.rowid LIMIT 1);

-- Fold the group into the survivor row. Both the counters and the rating are
-- DERIVED from the participant rows, which nothing in this file writes.
--
-- Summing the duplicate rating rows is not replayable: the survivor's own row
-- is part of the group, so once it holds the total a replay adds the duplicates
-- again — and a crash between this statement and the delete below replays from
-- the top, inflating every merged member permanently. Keeping one half's rating
-- and deleting the rest is worse than lossy: 1031 in one half and 1016 in the
-- other becomes 1031, while the counter beside it counts both halves' games.
--
-- Each participant row carries the rating before and after ITS match, so the
-- differences are the movement this member earned; DEFAULT_RATING plus that sum
-- is where the merged history leaves them, and COUNT(*) over the same rows is
-- how many games it took. Neither is a true replay — every delta was computed
-- against the base its own half held — but they agree with each other, they
-- repair the drift 003 left behind, and they land on the same numbers however
-- often this file runs. MAX(100, …) is the floor the client applies per match.
--
-- The first WHERE clause — "no category ranks below mine in my group" — puts
-- the merged numbers on the row that survives, and keeps every row this
-- statement reads out of the set it writes. The second confines it to members
-- who have a split; a household with no duplicates is left exactly as it was.
--
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
          AND m.category_id = app_leaderboard__lb_ratings.category_id AND p.result = 'loss')
 WHERE NOT EXISTS (SELECT 1
         FROM app_leaderboard__lb_categories p, app_leaderboard__lb_categories c
        WHERE c.id = app_leaderboard__lb_ratings.category_id
          AND p.name = c.name AND p.game_type = c.game_type AND p.rowid < c.rowid)
   AND EXISTS (SELECT 1
         FROM app_leaderboard__lb_ratings x, app_leaderboard__lb_categories xc, app_leaderboard__lb_categories mc
        WHERE x.member_id = app_leaderboard__lb_ratings.member_id
          AND x.category_id <> app_leaderboard__lb_ratings.category_id
          AND xc.id = x.category_id AND mc.id = app_leaderboard__lb_ratings.category_id
          AND xc.name = mc.name AND xc.game_type = mc.game_type);

-- The duplicates' rating rows, now absorbed above.
DELETE FROM app_leaderboard__lb_ratings
 WHERE EXISTS (SELECT 1
         FROM app_leaderboard__lb_categories p, app_leaderboard__lb_categories c
        WHERE c.id = app_leaderboard__lb_ratings.category_id
          AND p.name = c.name AND p.game_type = c.game_type AND p.rowid < c.rowid);

-- And the duplicate categories. Nothing still points at them.
DELETE FROM app_leaderboard__lb_categories
 WHERE EXISTS (SELECT 1 FROM app_leaderboard__lb_categories p
        WHERE p.name = app_leaderboard__lb_categories.name
          AND p.game_type = app_leaderboard__lb_categories.game_type
          AND p.rowid < app_leaderboard__lb_categories.rowid);

CREATE UNIQUE INDEX IF NOT EXISTS app_leaderboard__lb_categories_identity_idx
  ON app_leaderboard__lb_categories (name, game_type);
