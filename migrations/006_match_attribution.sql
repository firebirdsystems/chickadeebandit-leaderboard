-- Trustworthy attribution for a match row.
--
-- A match used to be ANONYMOUS: it recorded who played and what it did to their
-- ratings, but nothing about who entered it. Ratings are computed in the browser
-- (this app is `runtime: "static"`), so no policy can make a score
-- authoritative — only a server could. What a policy CAN do is guarantee that
-- every match carries the identity of the session that created it, and that the
-- identity is not something the client gets to choose.
--
-- Both columns exist to let `lb_matches` be governed by owner_or_visibility
-- rather than member_writable, which is what makes the attribution real:
--
--   logged_by   the owner column. On INSERT the hub REPLACES whatever the client
--               sent with the caller's own member id, and refuses the statement
--               outright if the column is missing. So it can be neither forged
--               nor omitted — which a plain member_writable table could not
--               promise: that kind authenticates the caller but never binds a
--               column to them, so a client could name anybody, or leave the
--               field out and take the default.
--
--   visibility  the read arm. owner_or_visibility shows a member their own rows
--               plus any row whose visibility is public, so 'everyone' keeps the
--               match list household-wide, exactly as it was. Without it the
--               policy would collapse each member's view to matches they
--               personally entered.
--
-- Both are plaintext by construction — `_by` suffix and the builtin skip-list
-- entry for `visibility` — so the row-policy engine and member_references can
-- read them. NOT NULL DEFAULT keeps existing rows valid: pre-existing matches
-- carry an empty logged_by and honestly render as unattributed rather than being
-- assigned to somebody after the fact.
--
-- Writes stay open to children (INSERT is allowed for any member; the owner
-- column is simply forced), which the app needs — a child logging their own
-- ping-pong result is the point. Matches are insert-only in this app, so the
-- owner-scoping that owner_or_visibility applies to UPDATE/DELETE costs nothing.
ALTER TABLE app_leaderboard__lb_matches ADD COLUMN logged_by TEXT NOT NULL DEFAULT '';
ALTER TABLE app_leaderboard__lb_matches ADD COLUMN visibility TEXT NOT NULL DEFAULT 'everyone';

-- The ingestion cursor.
--
-- Imported matches used to be resumed from `MAX(played_at) WHERE source_event_id
-- IS NOT NULL` — the newest imported event's created_at, fed back as `since`.
-- Two ways that loses events for good:
--
--   * `since` is a TIMESTAMP, so it cannot separate two events sharing one
--     created_at, and it advances on wall-clock rather than on what was actually
--     processed.
--   * the page was processed in the API's newest-first order, so a failure on an
--     older event followed by a success on a newer one pushed the cursor past
--     the failure. Nothing ever returned to it.
--
-- rowid is monotonic and unique, and the events API exposes it as `sequence`
-- with an `after_sequence` filter that already handles rowid renumbering after a
-- purge. This column records WHICH EVENT produced a match — provenance, next to
-- the source_event_id that dedups it.
--
-- It is deliberately NOT the ingestion cursor. A cursor DERIVED from written
-- matches can only move when something is written, and most events legitimately
-- write nothing: one already imported is skipped by the dedup guard, and a
-- malformed payload is skipped forever. On an upgraded household every existing
-- imported match carries the DEFAULT 0, so a derived cursor sits at 0, the first
-- page of 500 is entirely deduped, nothing is written, the cursor stays at 0 —
-- and the same 500 events are re-read on every page until the runaway guard
-- trips. Event 501 is never reached and ingestion is stalled for good. The
-- cursor therefore lives in its own row (see below) and advances for skipped
-- events too.
ALTER TABLE app_leaderboard__lb_matches ADD COLUMN source_event_seq INTEGER NOT NULL DEFAULT 0;

-- Ingestion state, kept apart from the data it produces.
--
-- One row per key; today the only key is 'event_cursor', the highest event
-- sequence this household has finished with — whether that event produced a
-- match, was already imported, or was permanently unprocessable. Only a
-- TRANSIENT failure (a category a child cannot create, a write that errored)
-- holds it back, which is exactly the resume point a retry wants.
--
-- `value` is INTEGER for two independent reasons, and both matter:
--
--   * COMPARISON. The cursor is compared to move it forward. As TEXT that
--     comparison is lexicographic, where '900' > '1000' — so a monotonic guard
--     over a TEXT column would happily accept a cursor going backwards past
--     event 1000 and replay a thousand events.
--   * ENCRYPTION. This app sets `db_encryption: "off"`, so today every column is
--     stored as written. An INTEGER column does not depend on that staying
--     true: numeric values are outside the codec regardless, so the monotonic
--     upsert below keeps working if the app ever turns encryption on.
--
-- `key` is in the platform's plaintext skip-list, so `WHERE key = ?` matches
-- either way.
-- `epoch` sits in the SAME ROW as the sequence, not in a second row, because the
-- two are one fact: a sequence number means nothing without the generation it
-- was issued in. Stored apart, a tab holding a stale response could advance the
-- sequence past a cursor another tab had just reset for a NEW generation — the
-- sequence guard would see a bigger number and accept it, restoring a position
-- that no longer exists. One row lets the guard compare (epoch, sequence)
-- together, so an older generation can never win.
CREATE TABLE IF NOT EXISTS app_leaderboard__lb_sync (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0,
  epoch INTEGER NOT NULL DEFAULT 0
);

-- The UNIQUE (name, game_type) index that ensureCategory()'s ON CONFLICT needs
-- lives in 007, NOT here. Earlier versions let duplicate categories exist, so
-- the constraint has to be preceded by a fold of the rows that already violate
-- it — and a migration's sql is capped at 8000 characters, which this file is
-- already most of the way through.
