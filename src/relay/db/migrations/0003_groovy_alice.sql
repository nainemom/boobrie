CREATE TABLE "user_flags" (
	"address" text PRIMARY KEY NOT NULL,
	"flag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_flags_address_flag_pk" PRIMARY KEY("address","flag")
);
--> statement-breakpoint
ALTER TABLE "user_flags" ADD CONSTRAINT "user_flags_address_users_address_fk" FOREIGN KEY ("address") REFERENCES "public"."users"("address") ON DELETE cascade ON UPDATE no action;