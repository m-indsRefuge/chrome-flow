import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { checkWorkspaceManualPlacementTransactionPurity } from "./check-runtime-contract-purity.mjs";

const testDirectory = new URL("../tests/workspace-manual-placement-transaction/", import.meta.url);
const testFiles = readdirSync(testDirectory).filter((name) => name.endsWith(".test.js")).map((name) => "tests/workspace-manual-placement-transaction/" + name);
const test = spawnSync(process.execPath, ["--test", "--test-isolation=none", ...testFiles], { cwd: new URL("../", import.meta.url), stdio: "inherit" });
if (test.status !== 0) throw new Error("workspace manual placement tests failed");
const pureModuleCount = await checkWorkspaceManualPlacementTransactionPurity();
console.log(JSON.stringify({ schema: "constellation-workspace-manual-placement-validation-v0.1", testsPassed: true, pureModuleCount }));
