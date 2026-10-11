CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 5001 CACHE 1;--> statement-breakpoint
CREATE TABLE "group_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"share_token" text NOT NULL,
	"status" integer NOT NULL,
	"host_customer_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"idempotency_key" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
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
CREATE TABLE "order_refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"method" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"status" integer NOT NULL,
	"mode" integer NOT NULL,
	"customer_id" text NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_phone" text DEFAULT '' NOT NULL,
	"restaurant_id" text NOT NULL,
	"rider_id" text,
	"zone_id" text,
	"payment_kind" integer DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"request" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"placed_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
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
CREATE UNIQUE INDEX "group_orders_share_token_key" ON "group_orders" USING btree ("share_token");--> statement-breakpoint
CREATE UNIQUE INDEX "group_orders_idempotency_key" ON "group_orders" USING btree ("host_customer_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "order_refunds_idempotency_key" ON "order_refunds" USING btree ("order_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "order_refunds_order_idx" ON "order_refunds" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key" ON "orders" USING btree ("customer_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_restaurant_idx" ON "orders" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_rider_idx" ON "orders" USING btree ("rider_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","created_at");