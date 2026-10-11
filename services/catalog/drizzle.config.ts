import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` diffs src/db/schema.ts against drizzle/ and writes a new SQL migration.
// Migrations are applied by the service itself on start (src/platform/db/migrate.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
