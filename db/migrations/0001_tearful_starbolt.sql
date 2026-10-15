ALTER TABLE "transactions" ADD COLUMN "transfer_direction" varchar(3);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_idempotency_uniq" ON "transactions" USING btree ("user_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_direction_valid" CHECK (transfer_direction is null or transfer_direction in ('in', 'out'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_direction_required" CHECK ((type = 'transfer') = (transfer_direction is not null));