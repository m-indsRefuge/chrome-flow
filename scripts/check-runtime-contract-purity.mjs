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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const count = await checkRuntimeContractPurity();
  console.log("Runtime contract purity valid: " + count + " source modules.");
}
