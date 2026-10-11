CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"image_id" text DEFAULT '' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "closures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"date" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"placement" integer NOT NULL,
	"source" integer NOT NULL,
	"rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"restaurant_ids" text[] DEFAULT '{}' NOT NULL,
	"starts_on" text DEFAULT '' NOT NULL,
	"ends_on" text DEFAULT '' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL
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
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_minor" bigint NOT NULL,
	"image_id" text DEFAULT '' NOT NULL,
	"tags" integer[] DEFAULT '{}' NOT NULL,
	"option_group_ids" text[] DEFAULT '{}' NOT NULL,
	"popular_rank" integer DEFAULT 0 NOT NULL,
	"sold_out" boolean DEFAULT false NOT NULL,
	"sold_out_until" timestamp with time zone,
	"unit" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"legacy_id" text
);
--> statement-breakpoint
CREATE TABLE "menu_sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"slug" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"max_choices" integer DEFAULT 1 NOT NULL,
	"choices" jsonb NOT NULL,
	"position" integer NOT NULL
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
CREATE TABLE "restaurants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"legacy_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" integer DEFAULT 1 NOT NULL,
	"category_id" text NOT NULL,
	"cuisine" text DEFAULT '' NOT NULL,
	"image_id" text DEFAULT '' NOT NULL,
	"eta_min_minutes" integer NOT NULL,
	"eta_max_minutes" integer NOT NULL,
	"base_delivery_fee_minor" bigint DEFAULT 0 NOT NULL,
	"rating" double precision DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"price_level" integer DEFAULT 1 NOT NULL,
	"offer_id" text DEFAULT '' NOT NULL,
	"offer_label" text DEFAULT '' NOT NULL,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"free_delivery_offer" boolean DEFAULT false NOT NULL,
	"has_vegetarian" boolean DEFAULT false NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"lat" double precision DEFAULT 0 NOT NULL,
	"lng" double precision DEFAULT 0 NOT NULL,
	"zone_id" text DEFAULT '' NOT NULL,
	"busy_extra_minutes" integer DEFAULT 0 NOT NULL,
	"paused_until" timestamp with time zone,
	"admin_status" text DEFAULT 'open' NOT NULL,
	"admin_status_reason" text DEFAULT '' NOT NULL,
	"hours" jsonb NOT NULL,
	"menu_version" bigint DEFAULT 1 NOT NULL,
	"menu_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seed_runs" (
	"version" integer PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "closures" ADD CONSTRAINT "closures_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_section_id_menu_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."menu_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_sections" ADD CONSTRAINT "menu_sections_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "closures_restaurant_date_key" ON "closures" USING btree ("restaurant_id","date");--> statement-breakpoint
CREATE INDEX "menu_items_restaurant_idx" ON "menu_items" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "menu_items_section_idx" ON "menu_items" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "menu_sections_restaurant_idx" ON "menu_sections" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "option_groups_restaurant_idx" ON "option_groups" USING btree ("restaurant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurants_legacy_id_key" ON "restaurants" USING btree ("legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurants_slug_key" ON "restaurants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "restaurants_category_idx" ON "restaurants" USING btree ("category_id");