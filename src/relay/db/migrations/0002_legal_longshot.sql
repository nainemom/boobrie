CREATE TABLE "push_subscriptions" (
	"address" text PRIMARY KEY NOT NULL,
	"subscription" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_address_users_address_fk" FOREIGN KEY ("address") REFERENCES "public"."users"("address") ON DELETE cascade ON UPDATE no action;