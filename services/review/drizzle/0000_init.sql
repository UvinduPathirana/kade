CREATE TABLE "dish_ratings" (
	"order_id" text NOT NULL,
	"item_id" text NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"restaurant_id" text NOT NULL,
	"thumb" smallint NOT NULL,
	CONSTRAINT "dish_ratings_order_id_item_id_pk" PRIMARY KEY("order_id","item_id")
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
CREATE TABLE "order_ratings" (
	"order_id" text PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"rider_id" text DEFAULT '' NOT NULL,
	"rider_stars" smallint DEFAULT 0 NOT NULL,
	"rider_tags" text[] DEFAULT '{}' NOT NULL,
	"restaurant_stars" smallint DEFAULT 0 NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"first_rated_at" timestamp with time zone NOT NULL,
	"rated_at" timestamp with time zone NOT NULL
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
CREATE TABLE "rateable_orders" (
	"order_id" text PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" text NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"restaurant_id" text NOT NULL,
	"restaurant_name" text DEFAULT '' NOT NULL,
	"rider_id" text DEFAULT '' NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"dishes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_baselines" (
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"count" integer NOT NULL,
	"star_sum" integer NOT NULL,
	"breakdown" integer[] NOT NULL,
	"compliments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"improve" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "rating_baselines_subject_kind_subject_id_pk" PRIMARY KEY("subject_kind","subject_id")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" text,
	"restaurant_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"dish" text DEFAULT '' NOT NULL,
	"stars" smallint NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"reply_text" text,
	"reply_at" timestamp with time zone,
	"reply_by" text,
	CONSTRAINT "reviews_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "trip_feedback" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"rider_id" text NOT NULL,
	"customer" smallint DEFAULT 0 NOT NULL,
	"restaurant" smallint DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dish_ratings_restaurant_idx" ON "dish_ratings" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "order_ratings_restaurant_idx" ON "order_ratings" USING btree ("restaurant_id","rated_at");--> statement-breakpoint
CREATE INDEX "order_ratings_rider_idx" ON "order_ratings" USING btree ("rider_id","rated_at");--> statement-breakpoint
CREATE INDEX "reviews_restaurant_idx" ON "reviews" USING btree ("restaurant_id","created_at");