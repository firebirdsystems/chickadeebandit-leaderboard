-- current_standings.sql orders by c.name and caps at 200. The ordering leads on
-- the categories table, so the query drives from categories via a CROSS JOIN and
-- needs c.name available in order — otherwise every rating row is read and
-- sorted in a temp b-tree to return the first page.
--
-- `name` is orderable here because this app sets `db_encryption: "off"`, so its
-- columns are stored in the clear. In an app that encrypts, an index on `name`
-- would order AES ciphertext and be worse than useless.
--
-- `id` is appended so the join key comes from the index too.
CREATE INDEX IF NOT EXISTS app_leaderboard__lb_categories_name_idx
  ON app_leaderboard__lb_categories (name, id);
