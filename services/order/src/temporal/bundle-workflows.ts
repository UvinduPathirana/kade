// Build step (`pnpm build`): bundles the workflow code once into dist/workflow-bundle.js, so the
// container never runs webpack.
import { bundleWorkflowCode } from "@temporalio/worker";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const workflowsPath = fileURLToPath(new URL("../workflows/order.workflow.js", import.meta.url));
const out = fileURLToPath(new URL("../workflow-bundle.js", import.meta.url));
const { code } = await bundleWorkflowCode({ workflowsPath });
await writeFile(out, code);
console.log(`workflow bundle written: ${out} (${Math.round(code.length / 1024)} KiB)`);
