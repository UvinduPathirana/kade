#!/usr/bin/env node
// Scaffolds services/<name> from this template with names, ports and database substituted.
//
//   node services/_templates/ts/new-service.mjs <name> <grpcPort> <httpPort> [--db <database>] [--profile <profile>]
//   node services/_templates/ts/new-service.mjs catalog 50101 8101
//   node services/_templates/ts/new-service.mjs order 50107 8107 --db orders
//
// Use the ports, database and profile from docs/backend/CONVENTIONS.md (service registry).
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = dirname(fileURLToPath(import.meta.url));
const REPO = join(TEMPLATE, "..", "..", "..");

// deploy/compose/services.yaml: every fragment belongs to exactly one profile.
const PROFILES = {
  catalog: "ordering",
  search: "ordering",
  profile: "ordering",
  cart: "ordering",
  pricing: "ordering",
  order: "ordering",
  merchant: "fulfilment",
  notification: "engagement",
  review: "engagement",
  support: "engagement",
};

function fail(message) {
  console.error(`new-service: ${message}`);
  console.error(
    "usage: new-service.mjs <name> <grpcPort> <httpPort> [--db <database>] [--profile <profile>]",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const [, value] = args.splice(i, 2);
  if (!value) fail(`--${name} needs a value`);
  return value;
};
const dbFlag = flag("db");
const profileFlag = flag("profile");
const [name, grpcArg, httpArg] = args;

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) fail("name must be lowercase letters, digits and dashes");
const grpcPort = Number(grpcArg);
const httpPort = Number(httpArg);
for (const [label, port] of [
  ["grpcPort", grpcPort],
  ["httpPort", httpPort],
]) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`${label} must be a port number`);
}

const login = name.replaceAll("-", "_"); // Postgres login (dev password = login)
const database = dbFlag ?? login;
const profile = profileFlag ?? PROFILES[name] ?? "templates";
const target = join(REPO, "services", name);
if (existsSync(target)) fail(`${relative(REPO, target)} already exists`);

const SKIP = new Set(["node_modules", "dist", ".env", "new-service.mjs", "README.md"]);
cpSync(TEMPLATE, target, { recursive: true, filter: (src) => !SKIP.has(src.split("/").pop()) });

// Order matters: specific patterns before the generic `template-ts` / `template_ts`.
const replacements = [
  ["services/_templates/ts", `services/${name}`],
  [/template_ts:template_ts@([^/\s"]+)\/template_ts/g, `${login}:${login}@$1/${database}`],
  ["register-outbox.sh template_ts template_ts", `register-outbox.sh ${login} ${database}`],
  ["outbox-template_ts", `outbox-${login}`],
  ["@kade/template-ts", `@kade/${name}`],
  ["template-ts", name],
  ["template_ts", login],
  [/\b50100\b/g, String(grpcPort)],
  [/\b8100\b/g, String(httpPort)],
  ["profiles: [templates]", `profiles: [${profile}]`],
  ["--profile templates", `--profile ${profile}`],
  ["Compose fragment for the TypeScript service template.", `Compose fragment for ${name}.`],
  [/"description": "[^"]*"/g, `"description": "Kadé ${name} service."`],
  // The fragment moves from services/_templates/ts/ (3 deep) to services/<name>/ (2 deep).
  ["context: ../../..", "context: ../.."],
];

const TEXT = /\.(ts|mjs|json|ya?ml|md|sql|example|dockerignore)$|Dockerfile$/;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (TEXT.test(entry)) {
      const before = readFileSync(path, "utf8");
      let after = before;
      for (const [from, to] of replacements) after = after.replaceAll(from, to);
      if (after !== before) writeFileSync(path, after);
    }
  }
}
walk(target);
renameSync(
  join(target, "test/integration/template.int.test.ts"),
  join(target, `test/integration/${name}.int.test.ts`),
);

writeFileSync(
  join(target, "README.md"),
  `# ${name}

Scaffolded from \`services/_templates/ts\` (see its README for how the platform pieces work).

- **Owns:** TODO (tables, aggregate)
- **API:** TODO \`kade.${login.replaceAll("_", "")}.v1\` (proto/kade/<domain>/v1/<domain>_service.proto)
- **Events out:** TODO aggregate \`<x>\` -> \`kade.<x>.events\` (outbox)
- **Events in:** TODO topics consumed (group \`${name}\`)
- **Ports:** gRPC ${grpcPort}, HTTP ${httpPort} (\`/health/live\`, \`/health/ready\`, \`/metrics\`)
- **Database:** \`${database}\` (login \`${login}\`)

## Run alone

\`\`\`sh
pnpm infra:up
cp services/${name}/.env.example services/${name}/.env
pnpm --filter @kade/${name} dev
\`\`\`

## Test

\`\`\`sh
pnpm --filter @kade/${name} test               # unit
pnpm --filter @kade/${name} test:integration   # against the shared stack
\`\`\`
`,
);

console.log(`Created services/${name} (gRPC ${grpcPort}, HTTP ${httpPort}, db ${database}, profile ${profile}).

Next (checklist in services/_templates/ts/README.md):
  1. pnpm install
  2. Replace the notes example (src/notes, src/db/schema.ts service tables) and the proto service;
     then: rm -r services/${name}/drizzle && pnpm --filter @kade/${name} db:generate --name init
  3. pnpm --filter @kade/${name} test && pnpm --filter @kade/${name} build
  4. Run once so migrations create the outbox, then register Debezium:
     deploy/compose/connect/register-outbox.sh ${login} ${database}
  5. Ask the lead to include services/${name}/compose.yaml in deploy/compose/services.yaml`);
