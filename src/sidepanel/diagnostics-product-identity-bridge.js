import {
  CONSTELLATION_PRODUCT_NAME,
  FORMER_PRODUCT_NAME
} from "../core/constellation-product-identity.js";

const DIAGNOSTIC_PACKET_SCHEMA = "diagnostic-packet-v0.3";
const CANONICAL_PACKET_TYPE = CONSTELLATION_PRODUCT_NAME + " Diagnostic Packet";
const LEGACY_PACKET_TYPE = FORMER_PRODUCT_NAME + " Diagnostic Packet";
const LEGACY_GENERATED_NOTE = "This packet is generated locally by " + FORMER_PRODUCT_NAME + ".";
const CANONICAL_GENERATED_NOTE = "This packet is generated locally by " + CONSTELLATION_PRODUCT_NAME + ".";
const CLIPBOARD_BRIDGE_MARKER = Symbol.for("constellation.diagnosticClipboardIdentityBridge");

installDiagnosticProductIdentityBridge();

function installDiagnosticProductIdentityBridge() {
  installDiagnosticClipboardIdentityBridge();
  installClearDiagnosticsConfirmationBranding();
}

function installDiagnosticClipboardIdentityBridge() {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") return;

  const clipboardPrototype = Object.getPrototypeOf(clipboard);
  if (!clipboardPrototype || clipboardPrototype[CLIPBOARD_BRIDGE_MARKER]) return;

  const originalWriteText = clipboardPrototype.writeText;
  if (typeof originalWriteText !== "function") return;

  try {
    Object.defineProperty(clipboardPrototype, CLIPBOARD_BRIDGE_MARKER, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: true
    });

    Object.defineProperty(clipboardPrototype, "writeText", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function writeConstellationBrandedClipboardText(text) {
        return originalWriteText.call(this, brandDiagnosticPacketText(text));
      }
    });
  } catch (error) {
    console.warn("Constellation diagnostic clipboard identity bridge could not be installed:", error);
  }
}

function brandDiagnosticPacketText(text) {
  if (typeof text !== "string" || !text.trim().startsWith("{")) return text;

  let packet;

  try {
    packet = JSON.parse(text);
  } catch (_error) {
    return text;
  }

  if (!isSupportedDiagnosticPacket(packet)) return text;

  packet.packetType = CANONICAL_PACKET_TYPE;
  packet.extension = {
    ...packet.extension,
    name: CONSTELLATION_PRODUCT_NAME
  };

  if (Array.isArray(packet.notes)) {
    packet.notes = packet.notes.map((note) =>
      note === LEGACY_GENERATED_NOTE ? CANONICAL_GENERATED_NOTE : note
    );
  }

  return JSON.stringify(packet, null, 2);
}

function isSupportedDiagnosticPacket(packet) {
  if (!packet || typeof packet !== "object") return false;
  if (packet?.extension?.schema !== DIAGNOSTIC_PACKET_SCHEMA) return false;

  return packet.packetType === LEGACY_PACKET_TYPE
    || packet.packetType === CANONICAL_PACKET_TYPE;
}

function installClearDiagnosticsConfirmationBranding() {
  document.addEventListener("click", temporarilyBrandClearDiagnosticsConfirmation, true);
}

function temporarilyBrandClearDiagnosticsConfirmation(event) {
  const button = event.target?.closest?.("#clearDiagnosticsButton");
  if (!button || typeof window.confirm !== "function") return;

  const originalConfirm = window.confirm;
  let restored = false;

  const restoreConfirm = () => {
    if (restored) return;
    restored = true;
    window.confirm = originalConfirm;
  };

  window.confirm = function confirmWithConstellationIdentity(message) {
    restoreConfirm();

    const brandedMessage = String(message || "").replace(
      "Clear " + FORMER_PRODUCT_NAME + " developer diagnostics?",
      "Clear " + CONSTELLATION_PRODUCT_NAME + " developer diagnostics?"
    );

    return originalConfirm.call(window, brandedMessage);
  };

  queueMicrotask(restoreConfirm);
}

export {
  brandDiagnosticPacketText,
  isSupportedDiagnosticPacket
};
