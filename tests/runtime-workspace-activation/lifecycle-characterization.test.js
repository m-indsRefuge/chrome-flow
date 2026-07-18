import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createSessionAuthority, registerContext } from "../../src/core/runtime-session-authority/contract.js";

const SOURCE_ROOT = new URL("../../src/", import.meta.url);

test("characterization: context genesis remains assignment-free and startup adds an explicit activation producer", async () => {
  const root = createSessionAuthority("runtime-session-1");
  const registration = registerContext(root, {
    contextId: "side-panel-context-1",
    windowId: 10,
    createdAt: "2026-07-17T10:00:00.000Z",
    sourceUrl: "chrome-extension://extension-id/src/sidepanel/sidepanel.html"
  }, { genesis: true });

  assert.equal(registration.assignment, null, "context registration must not silently become activation");
  const sidePanelSource = await readSource("sidepanel/sidepanel.js");
  const workerSource = await readSource("background/service-worker.js");
  assert.match(sidePanelSource, /await\s+runtimeWorkspaceAuthority\.bootstrapExisting/);
  assert.match(workerSource, /handleRuntimeWorkspaceActivationMessage/);
});

test("characterization: startup must bootstrap a fresh zero-tab workspace before enabling handlers", async () => {
  const sourceText = await readSource("sidepanel/sidepanel.js");
  assert.match(
    sourceText,
    /await\s+[^;\n]*bootstrapExisting[^;\n]*;/,
    "INTENDED FAILURE: side-panel startup currently awaits no bootstrap_existing activation"
  );
});

test("characterization: reload genesis must have a production activation route", async () => {
  const sourceText = await readSource("background/service-worker.js");
  assert.match(
    sourceText,
    /handleRuntimeWorkspaceActivationMessage/,
    "INTENDED FAILURE: no service-worker activation producer can recover assignment after session genesis"
  );
});

test("characterization: Archive and Start Fresh must replace active authority", async () => {
  const sourceText = await readSource("sidepanel/workspace-archive-close-ownership-controller.js");
  assert.match(
    sourceText,
    /replaceActive/,
    "INTENDED FAILURE: Archive + Fresh currently writes the fresh runtime without assignment replacement"
  );
});

test("characterization: resume must not commit from a runtime write alone", async () => {
  const sourceText = await readSource("core/workspace-resume-transaction-engine.js");
  assert.match(
    sourceText,
    /replaceActive/,
    "INTENDED FAILURE: resume currently marks runtimeCommitted after a direct workspace write"
  );
});

test("characterization: a second-window panel must resolve to read-only without transfer", async () => {
  const sourceText = await readSource("sidepanel/sidepanel.js");
  assert.match(
    sourceText,
    /runtime-workspace-read-only|runtimeWorkspaceReadOnly|readOnlyConflict/,
    "INTENDED FAILURE: side-panel startup currently has no cross-window activation conflict state"
  );
});

test("characterization: manual move must coordinate browser, assignment, and placement", async () => {
  const sourceText = await readSource("sidepanel/sidepanel.js");
  assert.match(
    sourceText,
    /workspaceManualPlacement|requestManualPlacement|manualPlacementClient/,
    "INTENDED FAILURE: manual placement currently stops after the shared browser move engine"
  );
});

test("characterization: Current Workspace must reread compatible runtime after commits", async () => {
  const sourceText = await readSource("sidepanel/workspace-session-control.js");
  assert.match(
    sourceText,
    /readCompatibleStorageValue/,
    "INTENDED FAILURE: Current Workspace currently reads only the legacy key and can remain stale"
  );
});

test("characterization: saved-pointer wording must not imply runtime authority", async () => {
  const sources = await Promise.all([
    readSource("sidepanel/workspace-library-direct-refresh.js"),
    readSource("sidepanel/saved-workspace-registry.js"),
    readSource("sidepanel/workspace-library-product-surface.js")
  ]);
  assert.doesNotMatch(
    sources.join("\n"),
    /Active DB workspace|Active saved workspace|\[active DB\]|\[active saved\]/,
    "INTENDED FAILURE: durable activeWorkspaceId labels currently imply live runtime authority"
  );
});

async function readSource(relativePath) {
  return readFile(new URL(relativePath, SOURCE_ROOT), "utf8");
}
