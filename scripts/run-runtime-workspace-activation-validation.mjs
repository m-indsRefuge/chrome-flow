import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { checkRuntimeWorkspaceActivationPurity } from "./check-runtime-contract-purity.mjs";

const testDirectory = new URL("../tests/runtime-workspace-activation/", import.meta.url);
const testFiles = readdirSync(testDirectory).filter((name) => name.endsWith(".test.js")).map((name) => "tests/runtime-workspace-activation/" + name);
const test = spawnSync(process.execPath, ["--test", "--test-isolation=none", ...testFiles], { cwd: new URL("../", import.meta.url), stdio: "inherit" });
if (test.status !== 0) throw new Error("runtime workspace activation tests failed");
const pureModuleCount = await checkRuntimeWorkspaceActivationPurity();
console.log(JSON.stringify({ schema: "constellation-runtime-workspace-activation-validation-v0.1", testsPassed: true, pureModuleCount }));
