const IDENTITY_CONTRACT_SCHEMA = "constellation-identity-contract-v0.1";
const MIGRATION_STATE_SCHEMA = "constellation-storage-identity-migration-v0.1";

const IDENTITY_CLASSIFICATIONS = Object.freeze({
  canonical: "canonical",
  legacyCompatible: "legacy_compatible",
  historicalOnly: "historical_only"
});

const STORAGE_IDENTITIES = Object.freeze({
  activeWorkspace: Object.freeze({
    id: "activeWorkspace",
    area: "local",
    canonicalKey: "constellationActiveWorkspace",
    legacyKey: "chromeFlowWorkspace",
    classification: IDENTITY_CLASSIFICATIONS.legacyCompatible,
    authority: "active_runtime_memory",
    migrationPolicy: "canonical_first_legacy_fallback_write_through",
    conflictPolicy: "report_and_refuse_silent_overwrite"
  }),
  diagnostics: Object.freeze({
    id: "diagnostics",
    area: "local",
    canonicalKey: "constellationDiagnostics",
    legacyKey: "chromeFlowDiagnostics",
    classification: IDENTITY_CLASSIFICATIONS.legacyCompatible,
    authority: "developer_evidence_ring",
    migrationPolicy: "canonical_first_legacy_fallback_write_through",
    conflictPolicy: "merge_by_diagnostic_identity_then_write_through"
  }),
  diagnosticEventShard: Object.freeze({
    id: "diagnosticEventShard",
    area: "local",
    canonicalPrefix: "constellationDiagnosticEvent:",
    legacyPrefix: "chromeFlowDiagnosticEvent:",
    classification: IDENTITY_CLASSIFICATIONS.legacyCompatible,
    authority: "developer_evidence_shards",
    migrationPolicy: "read_both_write_canonical_and_legacy_until_retirement",
    conflictPolicy: "merge_by_diagnostic_identity"
  }),
  workspaceArchive: Object.freeze({
    id: "workspaceArchive",
    area: "local",
    canonicalKey: "constellationWorkspaceArchive",
    legacyKey: "chromeFlowWorkspaceArchive",
    classification: IDENTITY_CLASSIFICATIONS.legacyCompatible,
    authority: "legacy_runtime_archive_compatibility",
    migrationPolicy: "canonical_first_legacy_fallback_write_through",
    conflictPolicy: "report_and_refuse_silent_overwrite"
  }),
  workspaceLibrarySaveCoordinator: Object.freeze({
    id: "workspaceLibrarySaveCoordinator",
    area: "session_preferred",
    canonicalKey: "constellationWorkspaceLibrarySaveCoordinator",
    legacyKey: "chromeFlowWorkspaceLibrarySaveCoordinator",
    classification: IDENTITY_CLASSIFICATIONS.legacyCompatible,
    authority: "cross_context_save_coordination",
    migrationPolicy: "read_both_write_through",
    conflictPolicy: "prefer_newest_completedAtMs_and_report"
  }),
  migrationState: Object.freeze({
    id: "migrationState",
    area: "local",
    canonicalKey: "constellationStorageIdentityMigration",
    legacyKey: "",
    classification: IDENTITY_CLASSIFICATIONS.canonical,
    authority: "identity_migration_evidence",
    migrationPolicy: "canonical_only",
    conflictPolicy: "latest_completed_marker_wins"
  })
});

const SESSION_DB_IDENTITY = Object.freeze({
  logicalCanonicalName: "constellation-session-db",
  physicalCurrentName: "chrome-flow-session-db",
  classification: IDENTITY_CLASSIFICATIONS.legacyCompatible,
  version: 1,
  migrationPolicy: "preserve_physical_database_until_verified_export_import",
  duplicatePreventionKey: "workspaceId",
  stores: Object.freeze([
    "workspaces",
    "workspaceTabs",
    "sessions",
    "projections",
    "workspaceLinks",
    "constellations",
    "journalEntries",
    "timelineEvents",
    "summaryCards",
    "settings"
  ]),
  settings: Object.freeze({
    activeWorkspaceId: "activeWorkspaceId",
    dedicatedWindowThreshold: "dedicatedWindowThreshold"
  })
});

const EVENT_IDENTITIES = Object.freeze({
  workspaceLibrarySaveCompleted: Object.freeze({
    canonical: "constellation-workspace-library-save-completed",
    legacy: "chrome-flow-workspace-library-save-completed",
    classification: IDENTITY_CLASSIFICATIONS.legacyCompatible,
    migrationPolicy: "emit_and_accept_both"
  }),
  reconcileWorkspaceProjection: Object.freeze({
    canonical: "constellation-reconcile-workspace-projection",
    legacy: "chrome-flow-reconcile-workspace-projection",
    classification: IDENTITY_CLASSIFICATIONS.legacyCompatible,
    migrationPolicy: "emit_or_accept_both_during_transition"
  })
});

const PACKET_ENVELOPE_IDENTITY = Object.freeze({
  canonicalStart: "CONSTELLATION_PACKET_START",
  canonicalEnd: "CONSTELLATION_PACKET_END",
  canonicalFormat: "constellation_packet_envelope_v0.1",
  legacyStart: "CHROME_FLOW_PACKET_START",
  legacyEnd: "CHROME_FLOW_PACKET_END",
  legacyFormat: "chrome_flow_packet_envelope_v0.1",
  classification: IDENTITY_CLASSIFICATIONS.legacyCompatible,
  migrationPolicy: "new_packets_may_use_canonical_envelope_readers_accept_both"
});

const PACKET_SCHEMA_POLICY = Object.freeze({
  classification: IDENTITY_CLASSIFICATIONS.historicalOnly,
  rule: "Published versioned schema identifiers are immutable evidence contracts and are not renamed in place.",
  currentDiagnosticSchema: "diagnostic-packet-v0.3",
  migrationPolicy: "new_schema_version_required_for_structural_change"
});

function getStorageIdentity(identityId) {
  const identity = STORAGE_IDENTITIES[identityId];
  if (!identity) {
    throw new Error("Unknown Constellation storage identity: " + identityId + ".");
  }
  return identity;
}

export {
  EVENT_IDENTITIES,
  IDENTITY_CLASSIFICATIONS,
  IDENTITY_CONTRACT_SCHEMA,
  MIGRATION_STATE_SCHEMA,
  PACKET_ENVELOPE_IDENTITY,
  PACKET_SCHEMA_POLICY,
  SESSION_DB_IDENTITY,
  STORAGE_IDENTITIES,
  getStorageIdentity
};
