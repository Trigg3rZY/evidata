INSERT INTO "evidata_meta"."data_source_memberships" ("id", "user_id", "data_source_id", "role")
SELECT 'dsm_' || ds."id" || '_' || cm."user_id", cm."user_id", ds."id", 'owner'
FROM "evidata_meta"."data_sources" ds
JOIN "evidata_meta"."connection_memberships" cm
  ON cm."connection_id" = ds."connection_id" AND cm."role" = 'owner'
WHERE ds."connection_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "evidata_meta"."data_source_memberships" m
    WHERE m."data_source_id" = ds."id" AND m."user_id" = cm."user_id"
  );
