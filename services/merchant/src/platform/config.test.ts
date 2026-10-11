import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const valid = {
  SERVICE_NAME: "catalog",
  GRPC_PORT: "50101",
  HTTP_PORT: "8101",
  DATABASE_URL: "postgres://catalog:catalog@postgres:5432/catalog",
  KAFKA_BROKERS: "kafka:9092, kafka2:9092",
};

describe("loadConfig", () => {
  it("parses and applies defaults", () => {
    expect(loadConfig(valid)).toMatchObject({
      GRPC_PORT: 50101,
      KAFKA_BROKERS: ["kafka:9092", "kafka2:9092"],
      LOG_LEVEL: "info",
      DB_POOL_MAX: 5,
      SEED_DATA: true,
      DEMO_BOARD: true,
      HOUSEKEEPING_INTERVAL_MS: 15_000,
    });
    expect(loadConfig({ ...valid, DEMO_BOARD: "false", SEED_DATA: "0" })).toMatchObject({
      DEMO_BOARD: false,
      SEED_DATA: false,
    });
  });

  it("lists every problem at once and never echoes URLs (they carry passwords)", () => {
    const run = () =>
      loadConfig({
        ...valid,
        GRPC_PORT: "abc",
        HTTP_PORT: undefined,
        DATABASE_URL: "mysql://u:hunter2@db/x",
      });
    expect(run).toThrow(ConfigError);
    try {
      run();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('GRPC_PORT ("abc")');
      expect(message).toContain("HTTP_PORT (unset)");
      expect(message).toContain("DATABASE_URL (set)");
      expect(message).not.toContain("hunter2");
    }
  });
});
