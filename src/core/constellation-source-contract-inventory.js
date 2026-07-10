import {
  EVENT_IDENTITIES,
  IDENTITY_CLASSIFICATIONS,
  PACKET_ENVELOPE_IDENTITY,
  PACKET_SCHEMA_POLICY,
  SESSION_DB_IDENTITY,
  STORAGE_IDENTITIES
} from "./constellation-identity-contract.js";

const SOURCE_INVENTORY_SCHEMA = "constellation-source-contract-inventory-v0.1";
const MAX_FILES = 300;

async function buildConstellationSourceContractInventory() {
  const manifest = chrome.runtime.getManifest();
  const entryPoints = new Set();
  const sidePanelPath = manifest?.side_panel?.default_path || "";
  const serviceWorkerPath = manifest?.background?.service_worker || "";

  if (sidePanelPath) {
    entryPoints.add(normalizeExtensionPath(sidePanelPath));
    const html = await fetchExtensionText(sidePanelPath);
    for (const scriptPath of extractHtmlModuleScripts(html, sidePanelPath)) {
      entryPoints.add(scriptPath);
    }
  }

  if (serviceWorkerPath) entryPoints.add(normalizeExtensionPath(serviceWorkerPath));

  const scan = await scanReachableSourceFiles([...entryPoints]);
  const extracted = extractContractsFromSources(scan.sources);

  return {
    schema: SOURCE_INVENTORY_SCHEMA,
    createdAt: new Date().toISOString(),
    extensionVersion: manifest?.version || "",
    entryPoints: [...entryPoints].sort(),
    filesScanned: scan.sources.length,
    scannedPaths: scan.sources.map((source) => source.path).sort(),
    failedPaths: scan.failedPaths,
    truncatedAtFileLimit: scan.truncatedAtFileLimit,
    storage: {
      registeredIdentities: Object.values(STORAGE_IDENTITIES),
      sourceTokens: extracted.storageTokens
    },
    indexedDb: {
      contract: SESSION_DB_IDENTITY,
      sourceNames: extracted.databaseNames
    },
    events: {
      registeredIdentities: Object.values(EVENT_IDENTITIES),
      brandedTokens: extracted.brandedEventTokens,
      semanticContractCandidates: extracted.semanticContractCandidates
    },
    packets: {
      envelopeContract: PACKET_ENVELOPE_IDENTITY,
      schemaPolicy: PACKET_SCHEMA_POLICY,
      schemaTokens: extracted.packetSchemaTokens,
      envelopeTokens: extracted.packetEnvelopeTokens
    },
    classifications: classifyExtractedContracts(extracted),
    limitations: [
      "Inventory covers manifest and side-panel reachable HTML/JavaScript modules.",
      "Runtime-generated strings that do not exist as source literals require live packet evidence.",
      "Versioned historical packet schemas are inventoried but are not renamed in place."
    ]
  };
}

async function scanReachableSourceFiles(initialPaths) {
  const queue = [...new Set(initialPaths.map(normalizeExtensionPath).filter(Boolean))];
  const visited = new Set();
  const sources = [];
  const failedPaths = [];

  while (queue.length && visited.size < MAX_FILES) {
    const path = queue.shift();
    if (!path || visited.has(path)) continue;
    visited.add(path);

    try {
      const text = await fetchExtensionText(path);
      sources.push({ path, text });

      if (path.endsWith(".html")) {
        for (const scriptPath of extractHtmlModuleScripts(text, path)) {
          if (!visited.has(scriptPath)) queue.push(scriptPath);
        }
      }

      if (path.endsWith(".js")) {
        for (const importedPath of extractRelativeModulePaths(text, path)) {
          if (!visited.has(importedPath)) queue.push(importedPath);
        }
      }
    } catch (error) {
      failedPaths.push({
        path,
        error: {
          name: error?.name || "Error",
          message: error?.message || String(error)
        }
      });
    }
  }

  return {
    sources,
    failedPaths,
    truncatedAtFileLimit: queue.length > 0
  };
}

function extractContractsFromSources(sources) {
  const storageTokens = new Set();
  const databaseNames = new Set();
  const brandedEventTokens = new Set();
  const semanticContractCandidates = new Set();
  const packetSchemaTokens = new Set();
  const packetEnvelopeTokens = new Set();

  for (const source of sources) {
    const literals = extractStringLiterals(source.text);

    for (const literal of literals) {
      if (/^(chromeFlow|constellation)[A-Za-z0-9:._-]+$/.test(literal)) {
        storageTokens.add(literal);
      }

      if (/^(chrome-flow|constellation)-session-db$/.test(literal)) {
        databaseNames.add(literal);
      }

      if (/^(chrome-flow|constellation)-[a-z0-9-]+$/.test(literal)) {
        brandedEventTokens.add(literal);
      }

      if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}$/.test(literal)) {
        semanticContractCandidates.add(literal);
      }

      if (/(?:packet|schema|summary|contract|validation|envelope)-v\d+(?:\.\d+)*(?:-[a-z0-9-]+)?$/i.test(literal)
        || /-packet-v\d+/i.test(literal)) {
        packetSchemaTokens.add(literal);
      }

      if (/^(?:CHROME_FLOW|CONSTELLATION)_PACKET_(?:START|END)$/.test(literal)
        || /^(?:chrome_flow|constellation)_packet_envelope_v\d+(?:\.\d+)*$/.test(literal)) {
        packetEnvelopeTokens.add(literal);
      }
    }
  }

  return {
    storageTokens: [...storageTokens].sort(),
    databaseNames: [...databaseNames].sort(),
    brandedEventTokens: [...brandedEventTokens].sort(),
    semanticContractCandidates: [...semanticContractCandidates].sort(),
    packetSchemaTokens: [...packetSchemaTokens].sort(),
    packetEnvelopeTokens: [...packetEnvelopeTokens].sort()
  };
}

function classifyExtractedContracts(extracted) {
  return {
    storageTokens: extracted.storageTokens.map((token) => ({
      token,
      classification: token.startsWith("constellation")
        ? IDENTITY_CLASSIFICATIONS.canonical
        : IDENTITY_CLASSIFICATIONS.legacyCompatible
    })),
    databaseNames: extracted.databaseNames.map((token) => ({
      token,
      classification: token === SESSION_DB_IDENTITY.logicalCanonicalName
        ? IDENTITY_CLASSIFICATIONS.canonical
        : IDENTITY_CLASSIFICATIONS.legacyCompatible
    })),
    brandedEventTokens: extracted.brandedEventTokens.map((token) => ({
      token,
      classification: token.startsWith("constellation-")
        ? IDENTITY_CLASSIFICATIONS.canonical
        : IDENTITY_CLASSIFICATIONS.legacyCompatible
    })),
    packetSchemaTokens: extracted.packetSchemaTokens.map((token) => ({
      token,
      classification: IDENTITY_CLASSIFICATIONS.historicalOnly,
      rule: PACKET_SCHEMA_POLICY.rule
    })),
    packetEnvelopeTokens: extracted.packetEnvelopeTokens.map((token) => ({
      token,
      classification: token.startsWith("CONSTELLATION_") || token.startsWith("constellation_")
        ? IDENTITY_CLASSIFICATIONS.canonical
        : IDENTITY_CLASSIFICATIONS.legacyCompatible
    }))
  };
}

function extractHtmlModuleScripts(html, sourcePath) {
  const paths = [];
  const pattern = /<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    paths.push(resolveRelativeExtensionPath(sourcePath, match[1]));
  }
  return paths;
}

function extractRelativeModulePaths(source, sourcePath) {
  const paths = [];
  const patterns = [
    /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const specifier = match[1];
      if (specifier.startsWith(".")) {
        paths.push(resolveRelativeExtensionPath(sourcePath, specifier));
      }
    }
  }

  return [...new Set(paths)];
}

function extractStringLiterals(source) {
  const values = [];
  const pattern = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match;
  while ((match = pattern.exec(source))) {
    const value = match[2]
      .replace(/\\(["'`\\])/g, "$1")
      .trim();
    if (value && !value.includes("${")) values.push(value);
  }
  return values;
}

async function fetchExtensionText(path) {
  const response = await fetch(chrome.runtime.getURL(normalizeExtensionPath(path)));
  if (!response.ok) {
    throw new Error("Could not fetch extension source " + path + ": HTTP " + response.status + ".");
  }
  return response.text();
}

function resolveRelativeExtensionPath(sourcePath, specifier) {
  const baseUrl = new URL(chrome.runtime.getURL(normalizeExtensionPath(sourcePath)));
  const resolved = new URL(specifier, baseUrl);
  return normalizeExtensionPath(resolved.pathname);
}

function normalizeExtensionPath(path) {
  return String(path || "")
    .replace(/^chrome-extension:\/\/[^/]+\//, "")
    .replace(/^\/+/, "")
    .split("#")[0]
    .split("?")[0];
}

export {
  MAX_FILES,
  SOURCE_INVENTORY_SCHEMA,
  buildConstellationSourceContractInventory,
  extractContractsFromSources
};
