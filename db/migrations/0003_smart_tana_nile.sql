CREATE TABLE "fund_nav_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"nav" numeric(20, 4) NOT NULL,
	"nav_adjusted" numeric(20, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mutual_funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"bibit_id" varchar(32),
	"bareksa_id" varchar(32),
	"kontan_id" varchar(32),
	"makmur_id" varchar(32),
	"ojk_name" text,
	"name" text NOT NULL,
	"other_names" text,
	"manager" text,
	"type" varchar(48) NOT NULL,
	"currency" varchar(3) DEFAULT 'IDR' NOT NULL,
	"sharia" varchar(5) DEFAULT 'false' NOT NULL,
	"launch_date" timestamp with time zone,
	"is_tradable" varchar(5) DEFAULT 'false' NOT NULL,
	"latest_nav" numeric(20, 4),
	"latest_nav_date" timestamp with time zone,
	"nav_rows" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutual_funds_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_fund_watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fund_nav_history" ADD CONSTRAINT "fund_nav_history_fund_id_mutual_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."mutual_funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_fund_watchlist" ADD CONSTRAINT "user_fund_watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_fund_watchlist" ADD CONSTRAINT "user_fund_watchlist_fund_id_mutual_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."mutual_funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fund_nav_history_fund_date_uniq" ON "fund_nav_history" USING btree ("fund_id","date");--> statement-breakpoint
CREATE INDEX "fund_nav_history_fund_date_idx" ON "fund_nav_history" USING btree ("fund_id","date");--> statement-breakpoint
CREATE INDEX "mutual_funds_type_idx" ON "mutual_funds" USING btree ("type");--> statement-breakpoint
CREATE INDEX "mutual_funds_currency_idx" ON "mutual_funds" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "mutual_funds_sharia_idx" ON "mutual_funds" USING btree ("sharia");--> statement-breakpoint
CREATE INDEX "mutual_funds_tradable_idx" ON "mutual_funds" USING btree ("is_tradable");--> statement-breakpoint
CREATE INDEX "mutual_funds_manager_idx" ON "mutual_funds" USING btree ("manager");--> statement-breakpoint
CREATE UNIQUE INDEX "user_fund_watchlist_user_fund_uniq" ON "user_fund_watchlist" USING btree ("user_id","fund_id");--> statement-breakpoint
CREATE INDEX "user_fund_watchlist_user_idx" ON "user_fund_watchlist" USING btree ("user_id");