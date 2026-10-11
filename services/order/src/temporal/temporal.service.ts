import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from "@nestjs/common";
import { Client, Connection, WorkflowNotFoundError } from "@temporalio/client";
import { NativeConnection, Runtime, Worker, makeTelemetryFilterString } from "@temporalio/worker";
import type { SignalDefinition } from "@temporalio/workflow";
import { setTimeout as sleep } from "node:timers/promises";
import { DependencyClients } from "../clients/clients.module.js";
import { CheckoutService } from "../orders/checkout.js";
import { GroupService } from "../groups/group.service.js";
import { OrderRepository } from "../orders/order.repository.js";
import { OrderStore } from "../orders/order.store.js";
import { RefundService } from "../orders/refund.service.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { ReadinessProbes } from "../platform/health.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { createActivities } from "../workflows/activities.js";
import { ORDER_WORKFLOW, type OrderWorkflowInput } from "../workflows/types.js";
import { workflowSource } from "./workflow-source.js";

let runtimeInstalled = false;

/**
 * Temporal client (start + signal order workflows) and the order worker (task queue "order"), in
 * this process. The worker runs the saga's activities against this service's database and clients.
 */
@Injectable()
export class TemporalService implements OnModuleInit, OnApplicationBootstrap, BeforeApplicationShutdown {
  private connection: Connection | undefined;
  private _client: Client | undefined;
  private worker: Worker | undefined;
  private workerRun: Promise<void> | undefined;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(Database) private readonly database: Database,
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(OrderStore) private readonly store: OrderStore,
    @Inject(CheckoutService) private readonly checkout: CheckoutService,
    @Inject(RefundService) private readonly refunds: RefundService,
    @Inject(GroupService) private readonly groups: GroupService,
    @Inject(DependencyClients) private readonly clients: DependencyClients,
    @Inject(ReadinessProbes) probes: ReadinessProbes,
  ) {
    probes.register("temporal", () => this.ready());
  }

  get client(): Client {
    if (!this._client) throw new Error("temporal client not connected");
    return this._client;
  }

  async onModuleInit(): Promise<void> {
    this.connection = await retry(this.logger, "temporal client", () =>
      Connection.connect({ address: this.config.TEMPORAL_ADDRESS, connectTimeout: 5_000 }),
    );
    this._client = new Client({ connection: this.connection, namespace: this.config.TEMPORAL_NAMESPACE });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.TEMPORAL_WORKER) return;
    if (!runtimeInstalled) {
      runtimeInstalled = true;
      Runtime.install({
        logger: temporalLogger(this.logger),
        telemetryOptions: { logging: { filter: makeTelemetryFilterString({ core: "WARN" }), forward: {} } },
      });
    }
    const connection = await retry(this.logger, "temporal worker", () =>
      NativeConnection.connect({ address: this.config.TEMPORAL_ADDRESS }),
    );
    this.worker = await Worker.create({
      connection,
      namespace: this.config.TEMPORAL_NAMESPACE,
      taskQueue: this.config.TEMPORAL_TASK_QUEUE,
      ...workflowSource(),
      activities: createActivities({
        ...this.clients.deps,
        database: this.database,
        orders: this.orders,
        store: this.store,
        checkout: this.checkout,
        refunds: this.refunds,
        groups: this.groups,
        logger: this.logger.child({ component: "activities" }),
      }),
      // Small container: a handful of concurrent saga steps is plenty.
      maxConcurrentActivityTaskExecutions: 20,
      maxConcurrentWorkflowTaskExecutions: 20,
      maxCachedWorkflows: 200,
    });
    this.workerRun = this.worker.run().finally(() => connection.close());
    this.workerRun.catch((err: unknown) => this.logger.fatal({ err }, "temporal worker stopped"));
    this.logger.info(
      { taskQueue: this.config.TEMPORAL_TASK_QUEUE, namespace: this.config.TEMPORAL_NAMESPACE },
      "temporal worker running",
    );
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.worker && this.worker.getState() === "RUNNING") this.worker.shutdown();
    await this.workerRun?.catch(() => undefined);
    await this.connection?.close();
  }

  /** Worker healthy (or not configured) and the client connected. */
  ready(): boolean {
    if (!this._client) return false;
    if (!this.config.TEMPORAL_WORKER) return true;
    return this.worker?.getState() === "RUNNING";
  }

  async startOrderWorkflow(orderId: string): Promise<void> {
    const input: OrderWorkflowInput = { orderId, acceptTimeoutMs: this.config.ACCEPT_TIMEOUT_SECONDS * 1000 };
    try {
      await this.client.workflow.start(ORDER_WORKFLOW, {
        workflowId: orderId,
        taskQueue: this.config.TEMPORAL_TASK_QUEUE,
        args: [input],
        // The order row is the record; a duplicate start (retried PlaceOrder) is fine.
        workflowIdReusePolicy: "REJECT_DUPLICATE",
        memo: { kind: "order" },
      });
    } catch (err) {
      if ((err as Error).name === "WorkflowExecutionAlreadyStartedError") return;
      throw err;
    }
  }

  /** Signals an order workflow. False when it isn't running (finished, or never started). */
  async signal<Args extends unknown[]>(
    orderId: string,
    def: SignalDefinition<Args>,
    ...args: Args
  ): Promise<boolean> {
    try {
      await this.client.workflow.getHandle(orderId).signal(def, ...args);
      return true;
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) return false;
      throw err;
    }
  }
}

async function retry<T>(logger: Logger, what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 10) throw err;
      logger.warn({ err, attempt }, `${what}: connect failed; retrying`);
      await sleep(Math.min(5_000, 500 * attempt));
    }
  }
}

function temporalLogger(logger: Logger) {
  const log = logger.child({ component: "temporal" });
  const levels = { TRACE: "trace", DEBUG: "debug", INFO: "info", WARN: "warn", ERROR: "error" } as const;
  const at =
    (level: (typeof levels)[keyof typeof levels]) => (message: string, meta?: Record<string, unknown>) =>
      // webpack's stats dump (dev/tests bundle on the fly) is noise at info.
      log[level === "info" && message.startsWith("asset workflow-bundle") ? "debug" : level](
        meta ?? {},
        message,
      );
  return {
    log: (level: string, message: string, meta?: Record<string, unknown>) =>
      at(levels[level as keyof typeof levels] ?? "info")(message, meta),
    trace: at("trace"),
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
  };
}
