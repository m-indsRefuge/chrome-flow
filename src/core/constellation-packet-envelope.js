import {
  PACKET_ENVELOPE_IDENTITY
} from "./constellation-identity-contract.js";

const PACKET_CONTENT_TYPE = "application/json";

function createCanonicalClipboardBlock() {
  return {
    format: PACKET_ENVELOPE_IDENTITY.canonicalFormat,
    contentType: PACKET_CONTENT_TYPE,
    copyMode: "text_envelope",
    envelopeStart: PACKET_ENVELOPE_IDENTITY.canonicalStart,
    envelopeEnd: PACKET_ENVELOPE_IDENTITY.canonicalEnd,
    legacyEnvelopeAccepted: true
  };
}

function formatCanonicalPacketEnvelope(packet) {
  const clipboard = {
    ...createCanonicalClipboardBlock(),
    ...(packet?.clipboard || {})
  };
  const normalizedPacket = {
    ...packet,
    clipboard
  };

  return [
    PACKET_ENVELOPE_IDENTITY.canonicalStart,
    "packetType: " + String(normalizedPacket.packetType || "Constellation Packet"),
    "schema: " + String(normalizedPacket?.extension?.schema || normalizedPacket?.schema || "unknown"),
    "clipboardFormat: " + PACKET_ENVELOPE_IDENTITY.canonicalFormat,
    "createdAt: " + String(normalizedPacket.createdAt || new Date().toISOString()),
    "contentType: " + PACKET_CONTENT_TYPE,
    "",
    JSON.stringify(normalizedPacket, null, 2),
    "",
    PACKET_ENVELOPE_IDENTITY.canonicalEnd
  ].join("\n");
}

function parseCompatiblePacketEnvelope(text) {
  const source = String(text || "").trim();
  const identity = identifyEnvelope(source);
  if (!identity) {
    return {
      valid: false,
      status: "unsupported_or_missing_envelope",
      envelopeIdentity: "",
      packet: null,
      error: "Packet envelope markers were not recognized."
    };
  }

  const startIndex = source.indexOf(identity.start);
  const endIndex = source.lastIndexOf(identity.end);
  if (startIndex !== 0 || endIndex <= startIndex) {
    return {
      valid: false,
      status: "invalid_envelope_boundaries",
      envelopeIdentity: identity.name,
      packet: null,
      error: "Packet envelope boundaries are incomplete or out of order."
    };
  }

  const body = source.slice(identity.start.length, endIndex).trim();
  const jsonStart = body.indexOf("{");
  const jsonEnd = body.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return {
      valid: false,
      status: "json_payload_missing",
      envelopeIdentity: identity.name,
      packet: null,
      error: "Packet envelope does not contain a JSON object."
    };
  }

  try {
    const packet = JSON.parse(body.slice(jsonStart, jsonEnd + 1));
    return {
      valid: true,
      status: "parsed",
      envelopeIdentity: identity.name,
      packet,
      schema: packet?.extension?.schema || packet?.schema || "",
      legacyEnvelopeUsed: identity.name === "legacy_chrome_flow"
    };
  } catch (error) {
    return {
      valid: false,
      status: "json_payload_invalid",
      envelopeIdentity: identity.name,
      packet: null,
      error: error?.message || String(error)
    };
  }
}

function identifyEnvelope(text) {
  const canonicalStart = PACKET_ENVELOPE_IDENTITY.canonicalStart;
  const legacyStart = PACKET_ENVELOPE_IDENTITY.legacyStart;

  if (text.startsWith(canonicalStart) && text.endsWith(PACKET_ENVELOPE_IDENTITY.canonicalEnd)) {
    return {
      name: "canonical_constellation",
      start: canonicalStart,
      end: PACKET_ENVELOPE_IDENTITY.canonicalEnd,
      format: PACKET_ENVELOPE_IDENTITY.canonicalFormat
    };
  }

  if (text.startsWith(legacyStart) && text.endsWith(PACKET_ENVELOPE_IDENTITY.legacyEnd)) {
    return {
      name: "legacy_chrome_flow",
      start: legacyStart,
      end: PACKET_ENVELOPE_IDENTITY.legacyEnd,
      format: PACKET_ENVELOPE_IDENTITY.legacyFormat
    };
  }

  return null;
}

export {
  PACKET_CONTENT_TYPE,
  createCanonicalClipboardBlock,
  formatCanonicalPacketEnvelope,
  identifyEnvelope,
  parseCompatiblePacketEnvelope
};
