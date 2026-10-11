CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" smallint NOT NULL,
	"recipient_kind" smallint NOT NULL,
	"user_id" text,
	"phone" text,
	"email" text,
	"name" text,
	"template" text NOT NULL,
	"params" jsonb NOT NULL,
	"body" text NOT NULL,
	"status" smallint NOT NULL,
	"provider_reference" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"reference_id" text,
	"idempotency_key" text,
	"send_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_contacts" (
	"order_id" text PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" text NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_phone" text DEFAULT '' NOT NULL,
	"restaurant_id" text DEFAULT '' NOT NULL,
	"restaurant_name" text DEFAULT '' NOT NULL,
	"mode" smallint DEFAULT 0 NOT NULL,
	"payment_kind" smallint DEFAULT 0 NOT NULL,
	"rider_id" text DEFAULT '' NOT NULL,
	"rider_name" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"kind" smallint NOT NULL,
	"platform" smallint NOT NULL,
	"token" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_idempotency_key_uq" ON "notifications" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "notifications_reference_idx" ON "notifications" USING btree ("reference_id","id");--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("status","send_at");