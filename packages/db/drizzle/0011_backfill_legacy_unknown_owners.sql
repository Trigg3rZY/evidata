DO $backfill$
DECLARE
  owner_migration_applied_at timestamptz;
BEGIN
  IF to_regclass('public._evidata_migrations') IS NOT NULL THEN
    SELECT "applied_at" INTO owner_migration_applied_at
    FROM "public"."_evidata_migrations"
    WHERE "name" = '0010_harsh_king_bedlam'
    LIMIT 1;
  END IF;

  IF owner_migration_applied_at IS NULL THEN
    UPDATE "evidata_meta"."investigations"
    SET "owner_id" = '__legacy_unknown_owner__'
    WHERE "owner_id" IS NULL;
  ELSE
    UPDATE "evidata_meta"."investigations"
    SET "owner_id" = '__legacy_unknown_owner__'
    WHERE "owner_id" IS NULL
      AND "created_at" < owner_migration_applied_at;
  END IF;
END
$backfill$;
