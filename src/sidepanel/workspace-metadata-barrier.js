import { stableStringify } from "../core/constellation-storage-compatibility.js";

export function createWorkspaceMetadataBarrier({ commitSnapshot, recordFailure = async () => undefined }) {
  if (typeof commitSnapshot !== "function" || typeof recordFailure !== "function") throw new TypeError("Metadata barrier dependencies are invalid");
  let paused = false;
  let queued = null;
  let commitQueue = Promise.resolve({ ok: true });
  let protectedWorkQueue = Promise.resolve();

  function submit(snapshot, reason) {
    if (paused) {
      queued = { snapshot, reason };
      return Promise.resolve({ ok: true, queued: true });
    }
    return enqueue(snapshot, reason);
  }

  function run(work, initialSnapshot, initialReason = "metadata_barrier_flush") {
    if (typeof work !== "function") throw new TypeError("Metadata barrier work must be a function");
    const scheduled = protectedWorkQueue.then(() => runProtected(work, initialSnapshot, initialReason));
    protectedWorkQueue = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }

  async function runProtected(work, initialSnapshot, initialReason) {
    paused = true;
    await commitQueue;
    await commitSafely(initialSnapshot, initialReason);
    let result;
    try { result = await work(); }
    finally {
      paused = false;
      const deferred = queued;
      queued = null;
      if (deferred) await enqueue(deferred.snapshot, deferred.reason || "metadata_barrier_queued_input");
    }
    return result;
  }

  function enqueue(snapshot, reason) {
    commitQueue = commitQueue.then(() => commitSafely(snapshot, reason));
    return commitQueue;
  }

  async function commitSafely(snapshot, reason) {
    if (!snapshot) return { ok: true, skipped: true };
    try {
      const result = await commitSnapshot(snapshot, reason);
      return { ok: result?.ok !== false, result };
    } catch (error) {
      try { await recordFailure(error, reason); } catch { /* Failure evidence is non-authoritative. */ }
      return { ok: false, error };
    }
  }

  return {
    get paused() { return paused; },
    get hasQueuedSnapshot() { return queued !== null; },
    run,
    submit
  };
}

export function runWorkspaceMetadataWriterWithLatestSnapshot(barrier, captureSnapshot, work) {
  if (!barrier || typeof barrier.run !== "function" || typeof captureSnapshot !== "function" || typeof work !== "function") {
    throw new TypeError("Latest metadata writer dependencies are invalid");
  }
  return barrier.run(() => work(captureSnapshot()), null, "workspace_metadata_writer");
}

export function applyWorkspaceMetadataAutosaveSnapshot(workspace, snapshot, updatedAt) {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace) || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || typeof snapshot.name !== "string" || typeof snapshot.aim !== "string" || typeof updatedAt !== "string" || !updatedAt) {
    throw new TypeError("Workspace autosave snapshot is invalid");
  }
  return { ...workspace, name: snapshot.name, aim: snapshot.aim, updatedAt };
}

export async function saveWorkspaceDetailsAgainstLatest(input, adapters) {
  validateWriterInput(input, adapters);
  if (typeof adapters.isValidWorkspaceRole !== "function") throw new TypeError("Workspace Save writer dependencies are invalid");
  return adapters.withRuntimeStateLock(async () => {
    const workspace = await readLatestCompatibleWorkspace(adapters);
    const tabs = (workspace.workspaceType || "research") === input.workspaceType
      ? workspace.tabs.map((tab) => ({ ...tab }))
      : workspace.tabs.map((tab) => adapters.isValidWorkspaceRole(input.workspaceType, tab.role || "unassigned") ? { ...tab } : { ...tab, role: "unassigned" });
    const nextWorkspace = {
      ...workspace,
      name: input.name,
      aim: input.aim,
      workspaceType: input.workspaceType,
      tabs,
      updatedAt: input.updatedAt,
      timeline: [...workspace.timeline, {
        eventId: input.eventId,
        type: "workspace_saved",
        message: "Workspace saved.",
        createdAt: input.updatedAt
      }]
    };
    await writeAndVerifyCompatibleWorkspace(nextWorkspace, adapters);
    return { ok: true, status: "written", workspace: nextWorkspace };
  });
}

export async function updateWorkspaceTypeAgainstLatest(input, adapters) {
  validateWriterInput(input, adapters);
  if (typeof adapters.isValidWorkspaceRole !== "function" || typeof adapters.getWorkspaceTypeLabel !== "function") {
    throw new TypeError("Workspace type writer dependencies are invalid");
  }
  return adapters.withRuntimeStateLock(async () => {
    const workspace = await readLatestCompatibleWorkspace(adapters);
    const previousType = workspace.workspaceType || "research";
    const typeChanged = previousType !== input.workspaceType;
    const metadataChanged = (workspace.name || "") !== input.name || (workspace.aim || "") !== input.aim;
    if (!typeChanged && !metadataChanged) return { ok: true, status: "no_change", workspace };
    const tabs = typeChanged
      ? workspace.tabs.map((tab) => adapters.isValidWorkspaceRole(input.workspaceType, tab.role || "unassigned") ? { ...tab } : { ...tab, role: "unassigned" })
      : workspace.tabs.map((tab) => ({ ...tab }));
    const timeline = typeChanged ? [...workspace.timeline, {
      eventId: input.eventId,
      type: "workspace_type_updated",
      message: "Workspace type changed from " + adapters.getWorkspaceTypeLabel(previousType) + " to " + adapters.getWorkspaceTypeLabel(input.workspaceType) + ".",
      createdAt: input.updatedAt,
      previousType,
      nextType: input.workspaceType
    }] : [...workspace.timeline];
    const nextWorkspace = {
      ...workspace,
      name: input.name,
      aim: input.aim,
      workspaceType: input.workspaceType,
      tabs,
      updatedAt: input.updatedAt,
      timeline
    };
    await writeAndVerifyCompatibleWorkspace(nextWorkspace, adapters);
    return { ok: true, status: "written", workspace: nextWorkspace };
  });
}

function validateWriterInput(input, adapters) {
  if (!input || typeof input !== "object" || typeof input.name !== "string" || typeof input.aim !== "string" || typeof input.workspaceType !== "string" || !input.workspaceType || typeof input.eventId !== "string" || !input.eventId || typeof input.updatedAt !== "string" || !input.updatedAt) {
    throw new TypeError("Workspace metadata writer input is invalid");
  }
  if (!adapters || typeof adapters.withRuntimeStateLock !== "function" || typeof adapters.readCompatibleWorkspace !== "function" || typeof adapters.writeCompatibleWorkspace !== "function") {
    throw new TypeError("Workspace metadata writer adapters are invalid");
  }
}

async function readLatestCompatibleWorkspace(adapters) {
  const read = await adapters.readCompatibleWorkspace();
  if (
    !read || read.conflict === true || read.canonicalPresent !== true || read.legacyPresent !== true || read.equivalent !== true ||
    !read.value || typeof read.value !== "object" || Array.isArray(read.value) || !Array.isArray(read.value.tabs) || !Array.isArray(read.value.timeline) ||
    stableStringify(read.value) !== stableStringify(read.canonicalValue) || stableStringify(read.value) !== stableStringify(read.legacyValue)
  ) throw new Error("Compatible active workspace is unavailable for metadata writer");
  return structuredClone(read.value);
}

async function writeAndVerifyCompatibleWorkspace(nextWorkspace, adapters) {
  await adapters.writeCompatibleWorkspace(nextWorkspace);
  const verified = await readLatestCompatibleWorkspace(adapters);
  if (stableStringify(verified) !== stableStringify(nextWorkspace)) throw new Error("Workspace metadata writer verification failed");
}
