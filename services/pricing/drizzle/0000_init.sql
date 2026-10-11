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
CREATE TABLE "pricing_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"rules_version" bigint DEFAULT 1 NOT NULL,
	"weather_enabled" boolean DEFAULT false NOT NULL,
	"weather_amount_minor" bigint NOT NULL,
	"plus_free_delivery_from_minor" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_settings_single_row" CHECK ("pricing_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surcharge_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"days" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"base_fee_minor" bigint NOT NULL,
	"per_km_minor" bigint NOT NULL,
	"small_order_fee_minor" bigint NOT NULL,
	"small_order_under_minor" bigint NOT NULL,
	"riders_needed" integer DEFAULT 0 NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"radius_km" double precision NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_code_unique" UNIQUE("code")
);
