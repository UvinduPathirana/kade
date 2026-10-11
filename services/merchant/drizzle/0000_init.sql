CREATE TABLE "demo_seeds" (
	"key" text PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregatetype" text NOT NULL,
	"aggregateid" text NOT NULL,
	"type" text NOT NULL,
	"payload" "bytea" NOT NULL,
	"traceparent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlet_staff" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"role" text NOT NULL,
	"pending" boolean DEFAULT true NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"zone_id" text DEFAULT '' NOT NULL,
	"cuisine" text DEFAULT '' NOT NULL,
	"category_id" text DEFAULT '' NOT NULL,
	"image_id" text DEFAULT '' NOT NULL,
	"owner_name" text DEFAULT '' NOT NULL,
	"owner_phone" text DEFAULT '' NOT NULL,
	"owner_email" text DEFAULT '' NOT NULL,
	"busy_extra_minutes" integer DEFAULT 0 NOT NULL,
	"paused_until" timestamp with time zone,
	"admin_status" text DEFAULT 'open' NOT NULL,
	"admin_status_reason" text DEFAULT '' NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"tablet_device_id" text,
	"accepting" boolean DEFAULT true NOT NULL,
	"commission_bps" integer DEFAULT 1800 NOT NULL,
	"bank" jsonb,
	"settings" jsonb NOT NULL,
	"rating" double precision DEFAULT 0 NOT NULL,
	"base_orders_week" integer DEFAULT 0 NOT NULL,
	"base_acceptance_rate" double precision DEFAULT 1 NOT NULL,
	"eta_min_minutes" integer DEFAULT 25 NOT NULL,
	"has_offer" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"owner_phone" text NOT NULL,
	"business" jsonb NOT NULL,
	"owner" jsonb NOT NULL,
	"documents" jsonb NOT NULL,
	"bank" jsonb,
	"bank_account_number" text,
	"menu" jsonb,
	"status" text NOT NULL,
	"decision_note" text DEFAULT '' NOT NULL,
	"zone_id" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"outlet_id" text
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"order_id" text PRIMARY KEY NOT NULL,
	"outlet_id" text NOT NULL,
	"source" text DEFAULT 'order' NOT NULL,
	"order_number" text NOT NULL,
	"ticket_number" text NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"customer_id" text DEFAULT '' NOT NULL,
	"customer_first_name" text DEFAULT '' NOT NULL,
	"repeat_count" integer DEFAULT 0 NOT NULL,
	"lines" jsonb NOT NULL,
	"kitchen_note" text DEFAULT '' NOT NULL,
	"cutlery" boolean DEFAULT false NOT NULL,
	"payment" text DEFAULT 'card' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"placed_at" timestamp with time zone NOT NULL,
	"accept_by" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"prep_minutes" integer DEFAULT 0 NOT NULL,
	"ready_by" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reject_reason" text,
	"reject_note" text DEFAULT '' NOT NULL,
	"delivery_id" text,
	"rider" jsonb,
	"rider_arrives_at" timestamp with time zone,
	"rider_at_counter" boolean DEFAULT false NOT NULL,
	"acted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outlet_staff" ADD CONSTRAINT "outlet_staff_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outlet_staff_outlet_phone_uq" ON "outlet_staff" USING btree ("outlet_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX "outlet_staff_outlet_user_uq" ON "outlet_staff" USING btree ("outlet_id","user_id");--> statement-breakpoint
CREATE INDEX "outlet_staff_user_idx" ON "outlet_staff" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "outlets_zone_idx" ON "outlets" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "outlets_admin_status_idx" ON "outlets" USING btree ("admin_status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_applications_reference_uq" ON "partner_applications" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "partner_applications_phone_idx" ON "partner_applications" USING btree ("owner_phone");--> statement-breakpoint
CREATE INDEX "partner_applications_status_idx" ON "partner_applications" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "tickets_outlet_open_idx" ON "tickets" USING btree ("outlet_id","closed_at");--> statement-breakpoint
CREATE INDEX "tickets_outlet_placed_idx" ON "tickets" USING btree ("outlet_id","placed_at");--> statement-breakpoint
CREATE INDEX "tickets_status_accept_by_idx" ON "tickets" USING btree ("status","accept_by");