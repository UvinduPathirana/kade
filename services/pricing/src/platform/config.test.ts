import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const valid = {
  SERVICE_NAME: "pricing",
  GRPC_PORT: "50105",
  HTTP_PORT: "8105",
  DATABASE_URL: "postgres://pricing:pricing@postgres:5432/pricing",
};

describe("loadConfig", () => {
  it("parses and applies defaults", () => {
    expect(loadConfig(valid)).toMatchObject({
      GRPC_PORT: 50105,
      RULES_CACHE_MS: 2000,
      LOG_LEVEL: "info",
      DB_POOL_MAX: 5,
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
