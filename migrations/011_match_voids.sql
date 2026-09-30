-- Voiding a match that was recorded by mistake.
--
-- A match is frozen the moment it exists (frozen_when on played_at), because
-- the Elo fold already wrote every player's movement from it: editing or
-- deleting the row would leave ratings computed from history that no longer
-- exists. A void is the correction instead — an append-only record, never an
-- edit. Inserting a row here fires the `revert_ratings` write effect in the
-- same transaction, which takes each player's recorded movement for that match
-- (lb_participant_ratings) back off their rating and un-counts the game.
--
-- The match row itself stays, so history still shows what was logged. The
-- primary key makes a second void of the same match fail, so the reversal can
-- never run twice. The foreign key refuses a void for a match that does not
-- exist: that row would revert nothing, then mark a later match inserted under
-- the same id as voided while its rating movement still counted.
--
-- There is deliberately no "voided by" column. The row policy is
-- adult_writable, which checks the caller is an adult but cannot pin a column
-- to who they are, so any adult could have put another member's name on a void.
CREATE TABLE IF NOT EXISTS app_leaderboard__lb_voids (
  match_id  TEXT NOT NULL PRIMARY KEY,
  reason    TEXT NOT NULL DEFAULT '',
  voided_at TEXT NOT NULL,
  FOREIGN KEY (match_id) REFERENCES app_leaderboard__lb_matches(id) ON DELETE CASCADE
);
