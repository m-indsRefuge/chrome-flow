import {
  DIAGNOSTIC_EVENT_PREFIX,
  LEGACY_DIAGNOSTICS_KEY,
  clearDiagnosticEvents,
  reconcileDiagnosticEventRing
} from "../core/diagnostic-event-store.js";

let reconcileTimer = null;
let reconcileInProgress = false;

installDiagnosticRingReconciler();

function installDiagnosticRingReconciler() {
  void reconcileSoon(0);

  if (globalThis.chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      const changedKeys = Object.keys(changes || {});
      const diagnosticChange = changedKeys.some((key) => key === LEGACY_DIAGNOSTICS_KEY || key.startsWith(DIAGNOSTIC_EVENT_PREFIX));
      if (!diagnosticChange) return;

      const legacyChange = changes?.[LEGACY_DIAGNOSTICS_KEY];
      const explicitlyCleared = Array.isArray(legacyChange?.oldValue)
        && legacyChange.oldValue.length > 0
        && Array.isArray(legacyChange?.newValue)
        && legacyChange.newValue.length === 0;

      if (explicitlyCleared) {
        void clearDiagnosticEvents();
        return;
      }

      void reconcileSoon(80);
    });
  }
}

function reconcileSoon(delayMs) {
  if (reconcileTimer) window.clearTimeout(reconcileTimer);

  reconcileTimer = window.setTimeout(async () => {
    reconcileTimer = null;
    if (reconcileInProgress) return;

    reconcileInProgress = true;
    try {
      await reconcileDiagnosticEventRing();
    } catch (error) {
      console.warn("Chrome Flow diagnostic reconciliation failed:", error);
    } finally {
      reconcileInProgress = false;
    }
  }, delayMs);
}
