CREATE TABLE "pending_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"recipient" text NOT NULL,
	"sender" text NOT NULL,
	"message_id" text NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pending_messages_recipient_idx" ON "pending_messages" USING btree ("recipient","id");