-- Finished games (game.completed) are imported by the hub, not the browser.
--
-- Two automatic rules (manifest suggested_automations, one per publisher) run
-- the `import_1v1_game` or `import_ranked_game` automation action, which inserts the match row with the
-- game's roster in these columns. The `expand_participants` write effect on
-- lb_matches then turns them into lb_participants rows in the same
-- transaction, ahead of the two rating folds that read those rows.
--
--   import_results_json  a ranked game's results[] as JSON text
--   import_winner_id     a 1v1 game's winner
--   import_loser_id      a 1v1 game's loser
--
-- All three stay NULL on a match logged by hand, which is what keeps the
-- expansion inert there: the app writes that match's participants itself.
ALTER TABLE app_leaderboard__lb_matches ADD COLUMN import_results_json TEXT;
ALTER TABLE app_leaderboard__lb_matches ADD COLUMN import_winner_id TEXT;
ALTER TABLE app_leaderboard__lb_matches ADD COLUMN import_loser_id TEXT;
