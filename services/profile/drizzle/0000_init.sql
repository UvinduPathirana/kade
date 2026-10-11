CREATE TABLE "addresses" (
	"customer_id" text NOT NULL,
	"id" text NOT NULL,
	"label" text NOT NULL,
	"line" text NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"zone_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addresses_customer_id_id_pk" PRIMARY KEY("customer_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text DEFAULT '' NOT NULL,
	"actor_roles" text[] DEFAULT '{}' NOT NULL,
	"actor_outlet_id" text DEFAULT '' NOT NULL,
	"actor_name" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"record_type" integer NOT NULL,
	"record_id" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount_minor" bigint NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"reason" integer NOT NULL,
	"order_id" text DEFAULT '' NOT NULL,
	"ticket_id" text DEFAULT '' NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"balance_after_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_reversals" (
	"customer_id" text NOT NULL,
	"order_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_reversals_customer_id_order_id_pk" PRIMARY KEY("customer_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"referral_code" text DEFAULT '' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"block_reason" text DEFAULT '' NOT NULL,
	"credit_balance_minor" bigint DEFAULT 0 NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"spend_minor" bigint DEFAULT 0 NOT NULL,
	"last_order_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favourites" (
	"customer_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favourites_customer_id_restaurant_id_pk" PRIMARY KEY("customer_id","restaurant_id")
);
--> statement-breakpoint
CREATE TABLE "fraud_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"kind" integer NOT NULL,
	"detail" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" integer NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"resolved_by" text DEFAULT '' NOT NULL,
	"resolved_at" timestamp with time zone
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
CREATE TABLE "phone_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"app" integer NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plus_memberships" (
	"customer_id" text PRIMARY KEY NOT NULL,
	"status" integer NOT NULL,
	"plan" integer NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"trial_ends_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"card_id" text DEFAULT '' NOT NULL,
	"card_label" text DEFAULT '' NOT NULL,
	"price_minor" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"customer_id" text PRIMARY KEY NOT NULL,
	"marketing_sms" boolean DEFAULT false NOT NULL,
	"marketing_email" boolean DEFAULT false NOT NULL,
	"order_updates_push" boolean DEFAULT true NOT NULL,
	"order_updates_sms" boolean DEFAULT true NOT NULL,
	"vegetarian" boolean DEFAULT false NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_signals" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"kind" integer NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" integer NOT NULL,
	"permission_id" text NOT NULL,
	CONSTRAINT "role_permissions_role_permission_id_pk" PRIMARY KEY("role","permission_id")
);
--> statement-breakpoint
CREATE TABLE "seed_runs" (
	"name" text PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" integer NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"customer_id" text NOT NULL,
	"place_id" text NOT NULL,
	"place_name" text DEFAULT '' NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_customer_id_place_id_pk" PRIMARY KEY("customer_id","place_id")
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plus_memberships" ADD CONSTRAINT "plus_memberships_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entries_at_idx" ON "audit_entries" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_entries_record_idx" ON "audit_entries" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE INDEX "audit_entries_actor_idx" ON "audit_entries" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "credit_entries_customer_at_idx" ON "credit_entries" USING btree ("customer_id","at");--> statement-breakpoint
CREATE INDEX "credit_entries_order_idx" ON "credit_entries" USING btree ("customer_id","order_id");--> statement-breakpoint
CREATE INDEX "customers_joined_at_idx" ON "customers" USING btree ("joined_at");--> statement-breakpoint
CREATE INDEX "fraud_flags_customer_idx" ON "fraud_flags" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "phone_challenges_phone_created_idx" ON "phone_challenges" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "risk_signals_customer_kind_at_idx" ON "risk_signals" USING btree ("customer_id","kind","at");