CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "macros" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_issues" (
	"order_id" text PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"kind" smallint NOT NULL,
	"lines" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"photo_ref" text DEFAULT '' NOT NULL,
	"photo_name" text DEFAULT '' NOT NULL,
	"resolution" smallint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"refund_id" text DEFAULT '' NOT NULL
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
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"from_kind" smallint NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"attached_order" jsonb
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"category" smallint NOT NULL,
	"priority" smallint NOT NULL,
	"requester_kind" smallint NOT NULL,
	"requester_id" text NOT NULL,
	"requester_name" text NOT NULL,
	"order_id" text,
	"order_number" text,
	"channel" smallint NOT NULL,
	"status" smallint NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"first_response_at" timestamp with time zone,
	"sla_breached_at" timestamp with time zone,
	"assignee_id" text,
	"assignee_name" text,
	"resolution" jsonb,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_issues" ADD CONSTRAINT "order_issues_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","at");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX "tickets_requester_idx" ON "tickets" USING btree ("requester_id","opened_at");--> statement-breakpoint
CREATE INDEX "tickets_order_idx" ON "tickets" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "tickets_sla_idx" ON "tickets" USING btree ("sla_due_at");