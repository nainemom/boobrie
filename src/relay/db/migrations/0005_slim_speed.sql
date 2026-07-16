ALTER TABLE "users" ADD COLUMN "handle" text;--> statement-breakpoint
UPDATE "users" SET "handle" = encode(sha256(address::bytea), 'hex') WHERE "handle" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "handle" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_handle_unique" UNIQUE("handle");