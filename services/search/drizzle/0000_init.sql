-- pg_trgm (fuzzy name matching) is a trusted extension: the database owner may create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
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
CREATE TABLE "places" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"detail" text NOT NULL,
	"area" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"in_zone" boolean NOT NULL,
	"zone_id" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "popular_searches" (
	"query" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_dishes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"snapshot" "bytea" NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"name_simple" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, name)) STORED,
	"name_english" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, name)) STORED,
	"doc_simple" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, name || ' ' || description)) STORED,
	"doc_english" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, name || ' ' || description)) STORED,
	"sold_out" boolean DEFAULT false NOT NULL,
	"sold_out_until" timestamp with time zone,
	"section_position" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_restaurants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"snapshot" "bytea",
	"snapshot_at" timestamp with time zone,
	"created_at" timestamp with time zone,
	"name" text DEFAULT '' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"name_simple" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, name)) STORED,
	"name_english" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, name)) STORED,
	"doc_simple" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, search_text)) STORED,
	"doc_english" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, search_text)) STORED,
	"lat" double precision DEFAULT 0 NOT NULL,
	"lng" double precision DEFAULT 0 NOT NULL,
	"availability_state" integer DEFAULT 0 NOT NULL,
	"availability_opens_at" timestamp with time zone,
	"availability_at" timestamp with time zone,
	"busy_extra_minutes" integer DEFAULT 0 NOT NULL,
	"hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"closed_dates" text[] DEFAULT '{}' NOT NULL,
	"hours_at" timestamp with time zone,
	"menu_version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "places_name_trgm_idx" ON "places" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "search_dishes_restaurant_idx" ON "search_dishes" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "search_dishes_doc_simple_idx" ON "search_dishes" USING gin ("doc_simple");--> statement-breakpoint
CREATE INDEX "search_dishes_doc_english_idx" ON "search_dishes" USING gin ("doc_english");--> statement-breakpoint
CREATE INDEX "search_dishes_name_trgm_idx" ON "search_dishes" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "search_restaurants_doc_simple_idx" ON "search_restaurants" USING gin ("doc_simple");--> statement-breakpoint
CREATE INDEX "search_restaurants_doc_english_idx" ON "search_restaurants" USING gin ("doc_english");--> statement-breakpoint
CREATE INDEX "search_restaurants_name_trgm_idx" ON "search_restaurants" USING gin ("name" gin_trgm_ops);