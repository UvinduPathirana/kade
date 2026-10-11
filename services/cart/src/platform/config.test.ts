import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const valid = {
  SERVICE_NAME: "cart",
  GRPC_PORT: "50104",
  HTTP_PORT: "8104",
  REDIS_URL: "redis://redis:6379",
  CATALOG_GRPC: "catalog:50101",
  PRICING_GRPC: "pricing:50105",
  PROMOTION_GRPC: "promotion:50106",
  PROFILE_GRPC: "profile:50103",
};

describe("loadConfig", () => {
  it("parses and applies defaults", () => {
    expect(loadConfig(valid)).toMatchObject({
      GRPC_PORT: 50104,
      LOG_LEVEL: "info",
      CART_TTL_SECONDS: 604_800,
      DOWNSTREAM_DEADLINE_MS: 2_000,
    });
  });

  it("lists every problem at once and never echoes URLs (they carry passwords)", () => {
    const run = () =>
      loadConfig({
        ...valid,
        GRPC_PORT: "abc",
        HTTP_PORT: undefined,
        REDIS_URL: "mysql://u:hunter2@db/x",
      });
    expect(run).toThrow(ConfigError);
    try {
      run();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('GRPC_PORT ("abc")');
      expect(message).toContain("HTTP_PORT (unset)");
      expect(message).toContain("REDIS_URL (set)");
      expect(message).not.toContain("hunter2");
    }
  });
});
