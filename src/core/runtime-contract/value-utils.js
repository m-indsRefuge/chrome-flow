export function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function serializableErrors(value, path = "payload", seen = new WeakSet()) {
  const errors = [];
  function visit(item, current) {
    if (item === null || ["string", "boolean"].includes(typeof item)) return;
    if (typeof item === "number") { if (!Number.isFinite(item)) errors.push(current + " must contain only finite numbers"); return; }
    if (["undefined", "function", "symbol", "bigint"].includes(typeof item)) { errors.push(current + " contains unsupported " + typeof item); return; }
    if (seen.has(item)) { errors.push(current + " contains a cycle"); return; }
    if (!Array.isArray(item) && !isPlainObject(item)) { errors.push(current + " contains a non-plain object"); return; }
    seen.add(item);
    if (Array.isArray(item)) item.forEach((entry, index) => visit(entry, current + "[" + index + "]"));
    else Object.keys(item).sort().forEach((key) => visit(item[key], current + "." + key));
    seen.delete(item);
  }
  visit(value, path);
  return errors;
}
export function clone(value) { return JSON.parse(JSON.stringify(value)); }
export function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (isPlainObject(value)) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
export function nonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
export function validDateTime(value) { return nonEmptyString(value) && !Number.isNaN(Date.parse(value)); }
