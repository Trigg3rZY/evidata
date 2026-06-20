CREATE TABLE "evidata_meta"."data_source_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"data_source_id" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_by" text,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidata_meta"."data_source_invites" ADD CONSTRAINT "data_source_invites_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "evidata_meta"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."data_source_invites" ADD CONSTRAINT "data_source_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "evidata_meta"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."data_source_invites" ADD CONSTRAINT "data_source_invites_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "evidata_meta"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ds_invite_token_uq" ON "evidata_meta"."data_source_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ds_invite_ds_idx" ON "evidata_meta"."data_source_invites" USING btree ("data_source_id");