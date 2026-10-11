import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Where the worker gets workflow code. In production (the image): the bundle prebuilt by `pnpm build`
 * (dist/workflow-bundle.js — no webpack at runtime, faster boot, much less memory). Otherwise (dev
 * watch mode, tests) the workflow module itself, bundled on the fly, so it is never stale.
 */
export function workflowSource(): { workflowBundle: { codePath: string } } | { workflowsPath: string } {
  const bundle = fileURLToPath(new URL("../workflow-bundle.js", import.meta.url));
  if (process.env.NODE_ENV === "production" && existsSync(bundle))
    return { workflowBundle: { codePath: bundle } };
  const js = fileURLToPath(new URL("../workflows/order.workflow.js", import.meta.url));
  const ts = fileURLToPath(new URL("../workflows/order.workflow.ts", import.meta.url));
  return { workflowsPath: existsSync(js) ? js : ts };
}
