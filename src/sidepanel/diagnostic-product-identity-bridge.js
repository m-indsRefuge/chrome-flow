import {
  CONSTELLATION_PRODUCT_NAME,
  FORMER_PRODUCT_NAME
} from "../core/constellation-product-identity.js";

const DIAGNOSTIC_PACKET_SCHEMA = "diagnostic-packet-v0.3";
const CANONICAL_PACKET_TYPE = CONSTELLATION_PRODUCT_NAME + " Diagnostic Packet";
const LEGACY_PACKET_TYPE = FORMER_PRODUCT_NAME + " Diagnostic Packet";
const LEGACY_GENERATED_NOTE = "This packet is generated locally by " + FORMER_PRODUCT_NAME + ".";
const CANONICAL_GENERATED_NOTE = "This packet is generated locally by " + CONSTELLATION_PRODUCT_NAME + ".";
const LEGACY_CLEAR_PROMPT = "Clear " + FORMER_PRODUCT_NAME + " developer diagnostics?";
const CANONICAL_CLEAR_PROMPT = "Clear " + CONSTELLATION_PRODUCT_NAME + " developer diagnostics?";
const CLIPBOARD_BRIDGE_MARKER = Symbol.for("constellation.diagnosticClipboardIdentityBridge");
const CONFIRM_BRIDGE_MARKER = Symbol.for("constellation.diagnosticConfirmIdentityBridge");

installDiagnosticProductIdentityBridge();

function installDiagnosticProductIdentityBridge() {
  installStableDiagnosticClipboardIdentityBridge();
  installStableConfirmationIdentityBridge();
}

function installStableDiagnosticClipboardIdentityBridge() {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") return;
  if (clipboard[CLIPBOARD_BRIDGE_MARKER]) return;

  const originalWriteText = clipboard.writeText.bind(clipboard);
  const brandedWriteText = function writeConstellationBrandedClipboardText(text) {
    return originalWriteText(brandDiagnosticPacketText(text));
  };

  try {
    Object.defineProperty(clipboard, "writeText", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: brandedWriteText
    });

    Object.defineProperty(clipboard, CLIPBOARD_BRIDGE_MARKER, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: true
    });
  } catch (error) {
    try {
      clipboard.writeText = brandedWriteText;
      clipboard[CLIPBOARD_BRIDGE_MARKER] = true;
    } catch (fallbackError) {
      console.warn("Constellation diagnostic clipboard identity bridge could not be installed:", {
        primary: summarizeBridgeError(error),
        fallback: summarizeBridgeError(fallbackError)
      });
    }
  }
}

function installStableConfirmationIdentityBridge() {
  if (typeof window.confirm !== "function") return;
  if (window.confirm[CONFIRM_BRIDGE_MARKER]) return;

  const originalConfirm = window.confirm.bind(window);
  const brandedConfirm = function confirmWithConstellationIdentity(message) {
    const brandedMessage = String(message || "").replace(
      LEGACY_CLEAR_PROMPT,
      CANONICAL_CLEAR_PROMPT
    );

    return originalConfirm(brandedMessage);
  };

  Object.defineProperty(brandedConfirm, CONFIRM_BRIDGE_MARKER, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true
  });

  try {
    Object.defineProperty(window, "confirm", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: brandedConfirm
    });
  } catch (error) {
    try {
      window.confirm = brandedConfirm;
    } catch (fallbackError) {
      console.warn("Constellation confirmation identity bridge could not be installed:", {
        primary: summarizeBridgeError(error),
        fallback: summarizeBridgeError(fallbackError)
      });
    }
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

function summarizeBridgeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error || "Unknown error")
  };
}

export {
  brandDiagnosticPacketText,
  isSupportedDiagnosticPacket
};
