# Leaderboard

A Chickadee Bandit hub app for tracking wins and ratings across any household competition — video games, foosball, board games, darts, and more.

## Features

- **Custom categories** — create any game with a name, icon, and type (1v1, teams, or co-op)
- **Elo-based ratings** — skill ratings that naturally reward beating stronger opponents and winning with weaker teammates
- **Team games** — foosball, doubles tennis, anything with two sides; all players on a team share the rating outcome
- **Co-op mode** — everyone on the same side (escape rooms, puzzle challenges); success or failure shifts ratings against a fixed baseline
- **Overall leaderboard** — composite rating weighted by games played per category; requires at least 3 games in a category to count
- **Category champions** — at-a-glance view of who leads each game
- **Hub widget** — medium-size widget showing the top-4 on the dashboard

## How Elo handles partner strength

When you win with a weaker partner, your team's average rating is lower, making the win less "expected." The Elo formula credits more points for less-expected wins, so carrying a weak teammate against strong opponents earns more than coasting with a strong partner. No custom code needed — it falls out of the math.

## Where the scoring runs

Ratings are computed by the **hub**, not by the browser, through `manifest.write_effects` on `lb_matches`. Recording a match sends one participant row per player and then the match row; the hub appends two statements to that same transaction, executed with its own authority:

| Effect | Fires on | What it does |
|---|---|---|
| `fold_participant_ratings` | `lb_matches` insert | Writes each player's `rating_before` / `rating_after` into `lb_participant_ratings` from the ratings live at that instant |
| `fold_ratings` | `lb_matches` insert | Folds those into `lb_ratings`, seeding a 1000-rated row for a first-time player |


Two things follow, and neither was reachable while the math ran client-side:

- **No race.** Concurrent matches serialize because their transactions do, so no two matches score against the same stale rating. Every open client ingests `game.completed` events, so concurrency here is routine rather than theoretical.
- **No forgery.** `column_write_acls` make `rating`, `games_played`, `wins` and `losses` unwritable by any client — only the effect lane bypasses those. `lb_ratings` used to be plainly member-writable, which meant any member could set their own rating to anything they liked.

`lb_participants` also carries a `UNIQUE (match_id, member_id)` index (migration 008). `fold_ratings` adds exactly 1 to `games_played` per participant row the match carries, so a member listed twice in one match would be counted twice — the index is what makes that arithmetic sound rather than merely conventional.

Participant rows are **evidence**, and they are settled the moment their match exists: `lb_participants` declares `frozen_when` against `lb_matches`, so once the match row lands nobody can rewrite a result, reassign a member, delete a player, or add one. Before that — the window in which the client is still assembling the batch — every column is additionally locked against `UPDATE`.

That freeze is why the movement lives in its own table. `frozen_when` and the old `UPDATE`-based fold could not coexist: admission refuses any non-`INSERT` effect against a table the manifest declares frozen, because the effect lane runs without row policies and would walk straight past the freeze. Moving the movement into `lb_participant_ratings` — written by an `INSERT` effect, locked against every client write, and frozen itself — leaves `lb_participants` written once and never again.

`lb_participants.rating_before` / `rating_after` remain as vestigial zeroes. They are `NOT NULL` with no default so a client `INSERT` must still name them, and `DROP COLUMN` is refused at admission, so they cannot be removed — only ignored. Read the movement from `lb_participant_ratings`.

**The batch order is a contract**: participant rows first, the match row last. The effects fold whatever participants the match id already has, so a match row written ahead of them scores an empty roster — silently. Anything that writes a match must keep the order.

## Development

```bash
npm install
npm run build     # produces dist/bundle.json
npm test          # runs __tests__/logic.test.mjs
bash preflight.sh # build + test (runs automatically on git push)
```

### First-time hook setup

```bash
git config core.hooksPath .githooks
```

## Releasing

Push to `main` or publish a GitHub release — the CI workflow builds `dist/bundle.json` and attaches it to the release. Install from the Chickadee Bandit marketplace using the bundle URL.

## Schema

Four tables in the app's isolated database (D1, i.e. SQLite — not Postgres):

| Table | Purpose |
|---|---|
| `lb_categories` | Custom game categories (name, icon, type) |
| `lb_matches` | Match records with timestamp and optional notes |
| `lb_participants` | Per-player match results and rating snapshots |
| `lb_ratings` | Live per-member, per-category Elo ratings and W/L record |
