ALTER TABLE lb_categories   ALTER COLUMN household_id TYPE uuid USING household_id::uuid;
ALTER TABLE lb_matches      ALTER COLUMN household_id TYPE uuid USING household_id::uuid;
ALTER TABLE lb_participants ALTER COLUMN household_id TYPE uuid USING household_id::uuid;
ALTER TABLE lb_ratings      ALTER COLUMN household_id TYPE uuid USING household_id::uuid;
