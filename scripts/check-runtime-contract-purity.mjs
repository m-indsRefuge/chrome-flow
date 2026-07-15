import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { posix } from "node:path";

function validFamilySpecifier(specifier) {
  const portable = specifier.replaceAll("\\", "/");
  if (!portable.startsWith("./") || !portable.endsWith(".js")) return false;
  const resolved = posix.normalize("/runtime-contract/" + portable.slice(2));
  return resolved.startsWith("/runtime-contract/") && !resolved.slice("/runtime-contract/".length).includes("/");
}

export function inspectRuntimeContractSource(name, source) {
  const errors = [];
  for (const match of source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) {
    if (!validFamilySpecifier(match[1])) errors.push(name + " imports outside the module family: " + match[1]);
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*(["'`])([^"'`$]+)\1\s*\)/g)) {
    if (!validFamilySpecifier(match[2])) errors.push(name + " dynamically imports outside the module family: " + match[2]);
  }
  const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "").replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, "");
  if (/\b(?:chrome|window|document|navigator|indexedDB|fetch|XMLHttpRequest|WebSocket)\b/.test(executable)) errors.push(name + " uses a forbidden runtime global");
  if (/\bglobalThis\s*\[\s*["'](?:chrome|window|document|navigator|indexedDB|fetch|XMLHttpRequest|WebSocket)["']\s*\]/.test(source)) errors.push(name + " uses computed access to a forbidden runtime global");
  if (/^\s*globalThis(?:\s*\[[^\]]+\]|\.[A-Za-z_$][\w$]*)\s*=/m.test(executable)) errors.push(name + " assigns to globalThis during module evaluation");
  if (/^\s*(?:await\s+|(?:globalThis\.)?(?:addEventListener|setInterval|setTimeout)\s*\(|(?:console|globalThis\.console)\s*\.)/m.test(executable)) errors.push(name + " contains an obvious module-evaluation side effect");
  if (/^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:globalThis\.)?console\s*\./m.test(executable)) errors.push(name + " contains an obvious top-level console side effect");
  return errors;
}

export async function checkRuntimeContractPurity(root = new URL("../src/core/runtime-contract/", import.meta.url)) {
  let names;
  try { names = await readdir(root); } catch { throw new Error("runtime-contract directory is absent"); }
  if (!names.length) throw new Error("runtime-contract directory is empty");
  for (const name of names) {
    if (!name.endsWith(".js")) throw new Error("unexpected runtime-contract artifact: " + name);
    const errors = inspectRuntimeContractSource(name, await readFile(new URL(name, root), "utf8"));
    if (errors.length) throw new Error(errors.join("\n"));
  }
  return names.length;
}

export async function checkReconciliationPurity(root = new URL("../src/core/workspace-projection-reconciliation/", import.meta.url)) {
  const names = (await readdir(root)).filter((name) => name !== "chrome-adapter.js");
  const allowed = new Set(["contract.js", "planner.js", "coordinator.js", "scheduler.js"]);
  for (const name of names) {
    if (!allowed.has(name)) throw new Error("unexpected pure reconciliation artifact: " + name);
    const source = await readFile(new URL(name, root), "utf8");
    const browserErrors = inspectRuntimeContractSource(name, source).filter((error) => !error.includes("imports outside the module family"));
    if (browserErrors.length) throw new Error(browserErrors.join("\n"));
    for (const match of source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) {
      const specifier = match[1].replaceAll("\\", "/");
      if (!(specifier.startsWith("./") || specifier.startsWith("../runtime-contract/"))) throw new Error(name + " imports outside approved pure families: " + match[1]);
    }
  }
  return names.length;
}

export async function checkRuntimeSessionAuthorityPurity(root = new URL("../src/core/runtime-session-authority/", import.meta.url)) {
  const names = (await readdir(root)).filter((name) => name !== "chrome-adapter.js");
  const allowed = new Set(["client.js", "contract.js", "coordinator.js"]);
  for (const name of names) {
    if (!allowed.has(name)) throw new Error("unexpected pure runtime session authority artifact: " + name);
    const source = await readFile(new URL(name, root), "utf8");
    const browserErrors = inspectRuntimeContractSource(name, source).filter((error) => !error.includes("imports outside the module family"));
    if (browserErrors.length) throw new Error(browserErrors.join("\n"));
    for (const match of source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) {
      const specifier = match[1].replaceAll("\\", "/");
      if (!(specifier.startsWith("./") || specifier.startsWith("../runtime-contract/"))) throw new Error(name + " imports outside approved pure families: " + match[1]);
    }
  }
  return names.length;
}

export async function checkWorkspaceResolutionPurity(root = new URL("../src/core/workspace-resolution/", import.meta.url)) {
  const names = await readdir(root);
  const allowed = new Set(["resolver.js"]);
  for (const name of names) {
    if (!allowed.has(name)) throw new Error("unexpected workspace-resolution artifact: " + name);
    const source = await readFile(new URL(name, root), "utf8");
    const browserErrors = inspectRuntimeContractSource(name, source).filter((error) => !error.includes("imports outside the module family"));
    if (browserErrors.length) throw new Error(browserErrors.join("\n"));
    for (const dependency of inspectWorkspaceResolutionDependencies(source, name)) if (!validWorkspaceResolutionSpecifier(dependency.specifier)) throw new Error(name + " imports outside approved pure families: " + dependency.specifier);
  }
  return names.length;
}

export async function checkWorkspaceResolutionCoordinationPurity(root = new URL("../src/core/workspace-resolution-coordination/", import.meta.url)) {
  const names = await readdir(root);
  const allowed = new Set(["contract.js", "coordinator.js"]);
  for (const name of names) {
    if (!allowed.has(name)) throw new Error("unexpected workspace-resolution-coordination artifact: " + name);
    const source = await readFile(new URL(name, root), "utf8");
    const browserErrors = inspectRuntimeContractSource(name, source).filter((error) => !error.includes("imports outside the module family"));
    if (browserErrors.length) throw new Error(browserErrors.join("\n"));
    for (const dependency of inspectWorkspaceResolutionDependencies(source, name)) if (!validWorkspaceResolutionCoordinationSpecifier(dependency.specifier)) throw new Error(name + " imports outside approved pure families: " + dependency.specifier);
  }
  return names.length;
}

export function validWorkspaceResolutionCoordinationSpecifier(specifier) {
  if (typeof specifier !== "string" || specifier.includes("?") || specifier.includes("#")) return false;
  const canonical = /^\.\/[^/\\]+\.js$/.test(specifier) || /^\.\.\/runtime-contract\/[^/\\]+\.js$/.test(specifier) || specifier === "../workspace-resolution/resolver.js";
  if (!canonical) return false;
  const resolved = posix.normalize("/core/workspace-resolution-coordination/" + specifier);
  const parent = posix.dirname(resolved);
  return parent === "/core/workspace-resolution-coordination" || parent === "/core/runtime-contract" || resolved === "/core/workspace-resolution/resolver.js";
}

export async function checkWorkspaceCreationAssignmentTransactionPurity(root = new URL("../src/core/workspace-creation-assignment-transaction/", import.meta.url)) {
  const names = await readdir(root);
  const allowed = new Set(["contract.js", "fingerprint.js", "state-machine.js", "coordinator.js"]);
  for (const name of names) {
    if (!allowed.has(name)) throw new Error("unexpected workspace-creation-assignment-transaction artifact: " + name);
    const source = await readFile(new URL(name, root), "utf8");
    const browserErrors = inspectRuntimeContractSource(name, source).filter((error) => !error.includes("imports outside the module family"));
    if (browserErrors.length) throw new Error(browserErrors.join("\n"));
    const lexical = maskCommentsAndTemplates(source);
    if (/\b(?:Date\s*\.\s*now|new\s+Date|Math\s*\.\s*random|crypto|setTimeout|setInterval|localStorage|sessionStorage|indexedDB|process\s*\.|console\s*\.)\b/.test(lexical)) throw new Error(name + " contains a forbidden nondeterministic or environmental dependency");
    if (/\.\s*localeCompare\s*\(/.test(lexical)) throw new Error(name + " contains locale-sensitive comparison");
    for (const dependency of inspectWorkspaceResolutionDependencies(source, name)) if (!validWorkspaceCreationAssignmentTransactionSpecifier(dependency.specifier)) throw new Error(name + " imports outside approved pure families: " + dependency.specifier);
  }
  return names.length;
}

export function validWorkspaceCreationAssignmentTransactionSpecifier(specifier) {
  if (typeof specifier !== "string" || specifier.includes("?") || specifier.includes("#")) return false;
  if (/^\.\/[^/\\]+\.js$/.test(specifier)) return posix.dirname(posix.normalize("/core/workspace-creation-assignment-transaction/" + specifier)) === "/core/workspace-creation-assignment-transaction";
  return ["../runtime-contract/value-utils.js", "../runtime-contract/assignments.js", "../runtime-contract/ledger.js", "../workspace-resolution-coordination/contract.js"].includes(specifier);
}

export async function checkWorkspaceExistingTabMoveEnginePurity(root = new URL("../src/core/workspace-existing-tab-move-engine/", import.meta.url)) {
  const names = await readdir(root);
  const allowed = new Set(["contract.js", "coordinator.js"]);
  for (const name of names) {
    if (!allowed.has(name)) throw new Error("unexpected workspace-existing-tab-move-engine artifact: " + name);
    const source = await readFile(new URL(name, root), "utf8");
    const lexical = maskCommentsAndTemplates(source);
    if (/\bimport\s*\./.test(lexical) || /\bimport\s*\(/.test(lexical)) throw new Error(name + " contains a forbidden dynamic or meta import");
    if (/\.\s*localeCompare\s*\(/.test(lexical)) throw new Error(name + " contains locale-sensitive comparison");
    if (/\b(?:chrome|document|navigator|indexedDB|fetch|XMLHttpRequest|WebSocket|crypto|setTimeout|setInterval|localStorage|sessionStorage)\b/.test(lexical)) throw new Error(name + " contains a forbidden environmental dependency");
    if (/\bnew\s+Date\b/.test(lexical) || /\bDate\s*\.\s*now\b/.test(lexical) || /\bMath\s*\.\s*random\b/.test(lexical)) throw new Error(name + " contains a forbidden nondeterministic dependency");
    if (/\bprocess\s*\./.test(lexical) || /\bconsole\s*\./.test(lexical)) throw new Error(name + " contains a forbidden host dependency");
    if (/\b(?:globalThis\s*\.\s*)?window\s*[.[]/.test(lexical)) throw new Error(name + " contains a forbidden window dependency");
    for (const dependency of inspectWorkspaceResolutionDependencies(source, name)) {
      if (!/^\.\/[^/\\]+\.js$/.test(dependency.specifier) || posix.dirname(posix.normalize("/core/workspace-existing-tab-move-engine/" + dependency.specifier)) !== "/core/workspace-existing-tab-move-engine") {
        throw new Error(name + " imports outside its pure family: " + dependency.specifier);
      }
    }
  }
  return names.length;
}

export function validWorkspaceResolutionSpecifier(specifier) {
  if (typeof specifier !== "string" || specifier.includes("?") || specifier.includes("#")) return false;
  const canonical = /^\.\/[^/\\]+\.js$/.test(specifier) || /^\.\.\/runtime-contract\/[^/\\]+\.js$/.test(specifier);
  if (!canonical) return false;
  const resolved = posix.normalize("/core/workspace-resolution/" + specifier);
  const parent = posix.dirname(resolved);
  return parent === "/core/workspace-resolution" || parent === "/core/runtime-contract";
}

function inspectWorkspaceResolutionDependencies(source, name) {
  const lexical = maskCommentsAndTemplates(source);
  if (/\bimport\s*\./.test(lexical)) throw new Error(name + " contains forbidden import.meta");
  if (/\bimport\s*\(/.test(lexical)) throw new Error(name + " contains a forbidden dynamic import");
  const dependencies = [];
  const classifiedImports = new Set();
  const patterns = [
    { kind: "import", expression: /\bimport\s*(["'])([^"']*)\1/g },
    { kind: "import", expression: /\bimport\b(?!\s*["'(])(?:(?!\bimport\b|;)[\s\S])*?\bfrom\s*(["'])([^"']*)\1/g },
    { kind: "export", expression: /\bexport\b(?:(?!\b(?:import|export)\b|;)[\s\S])*?\bfrom\s*(["'])([^"']*)\1/g }
  ];
  for (const { kind, expression } of patterns) for (const match of lexical.matchAll(expression)) {
    dependencies.push({ kind, specifier: match[2] });
    if (kind === "import") classifiedImports.add(match.index);
  }
  for (const match of lexical.matchAll(/\bimport\b/g)) if (!classifiedImports.has(match.index)) throw new Error(name + " contains unclassified module dependency syntax");
  return dependencies;
}

function maskCommentsAndTemplates(source) {
  let output = "", index = 0, state = "code";
  while (index < source.length) {
    const current = source[index], next = source[index + 1];
    if (state === "line") { if (isLineTerminator(current)) { output += current; state = "code"; } else output += " "; index += 1; continue; }
    if (state === "block") { if (current === "*" && next === "/") { output += "  "; index += 2; state = "code"; } else { output += current === "\n" ? "\n" : " "; index += 1; } continue; }
    if (current === "/" && next === "/") { output += "  "; index += 2; state = "line"; continue; }
    if (current === "/" && next === "*") { output += "  "; index += 2; state = "block"; continue; }
    if (current === "`") throw new Error("workspace-resolution source contains a forbidden template literal");
    if (current === '"' || current === "'") {
      const quote = current; output += current; index += 1;
      while (index < source.length) { const character = source[index]; output += character; index += 1; if (character === "\\" && index < source.length) { output += source[index]; index += 1; } else if (character === quote) break; }
      continue;
    }
    output += current; index += 1;
  }
  if (state === "block") throw new Error("workspace-resolution source contains unterminated lexical syntax");
  return output;
}

function isLineTerminator(character) { return character === "\n" || character === "\r" || character === "\u2028" || character === "\u2029"; }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const count = await checkRuntimeContractPurity();
  const reconciliationCount = await checkReconciliationPurity();
  const sessionAuthorityCount = await checkRuntimeSessionAuthorityPurity();
  const workspaceResolutionCount = await checkWorkspaceResolutionPurity();
  const workspaceResolutionCoordinationCount = await checkWorkspaceResolutionCoordinationPurity();
  const workspaceCreationAssignmentTransactionCount = await checkWorkspaceCreationAssignmentTransactionPurity();
  const workspaceExistingTabMoveEngineCount = await checkWorkspaceExistingTabMoveEnginePurity();
  console.log("Runtime contract purity valid: " + count + " runtime modules, " + reconciliationCount + " reconciliation modules, " + sessionAuthorityCount + " runtime session authority modules, " + workspaceResolutionCount + " workspace resolution modules, " + workspaceResolutionCoordinationCount + " workspace resolution coordination modules, " + workspaceCreationAssignmentTransactionCount + " workspace creation assignment transaction modules, and " + workspaceExistingTabMoveEngineCount + " workspace existing-tab move engine modules.");
}
