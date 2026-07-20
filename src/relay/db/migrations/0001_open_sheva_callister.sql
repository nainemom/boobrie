CREATE TABLE "deposits" (
	"payment_id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"granted_ms" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deposits_address_idx" ON "deposits" USING btree ("address");