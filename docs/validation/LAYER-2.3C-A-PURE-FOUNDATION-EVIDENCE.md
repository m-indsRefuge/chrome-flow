# Layer 2.3C-A Pure Foundation Evidence

## Scope

This evidence covers new dormant modules under `src/core/runtime-contract`, their Node tests, a lightweight purity checker, canonical package/CI commands, and contract documentation. Existing production runtime modules are not wired to the new family.

## Changed files

New: runtime-contract source modules, `tests/runtime-contract/runtime-contract.test.js`, `scripts/check-runtime-contract-purity.mjs`, this evidence record, and the Layer 2.3C architecture contract. Modified: `package.json`, `.github/workflows/pure-checks.yml`, and `docs/development/VALIDATION-PROTOCOL.md`.

## Validation evidence

Opening baseline on Node v24.16.0: `npm run check` passed with 13 characterization tests. Final commands are recorded after execution: `npm run check:inventory`, `npm run check:runtime-contract-purity`, `npm run test:characterization`, `npm run test:runtime-contract`, `npm test`, and two consecutive `npm run check` executions.

The repository remains zero-dependency: no dependency or lockfile is introduced and CI performs no install step. The checker rejects static or dynamic outside-family imports, Node imports, selected direct or computed browser/network globals, non-JavaScript artifacts, and obvious top-level global assignment, console, listener, timer, or await actions. In-memory adversarial fixtures prove these cases without leaving fixture artifacts. This remains a parser-light token guard rather than complete static analysis. Tests import every module in Node without a Chrome global.

The correction pass adds evidence for assignment-aware transitional fallback, stale epochs, occupied destinations, generated-ID conflicts, validated assignment inputs, exclusive tab-add identity, unsupported reducer dispatch, nested authorization serializability, `lastMatchStatus`, dirty assignment/epoch coherence and failure validation, revision-conflict replay, and input immutability. Transitional unassigned operations conflict once their workspace has an active assignment. Tab-add rejects missing identity and all redundant top-level identity forms.

The narrow final correction proves transfer atomicity for empty, current, and historical generated IDs: every failed transfer returns a registry deeply equal to its input, retains the active assignment, and preserves `nextEpoch`. Malformed BigInt, object, Symbol, and function identities produce JSON-serializable rejected results with unsafe identity fields normalized to empty strings and the ledger unchanged. Import adversaries cover parent traversal, normalized nested traversal, backslash traversal, literal template imports, and console calls inside top-level declarations; valid sibling imports remain accepted. The path and effect guard remains parser-light and does not claim complete JavaScript control-flow analysis.

No Chrome API, storage, IndexedDB, network, extension page, service worker, live extension, persistence, migration, import, archive, resume, recovery, rollback, production-save, or projection action is executed by this slice. Passing pure checks makes no live lifecycle or concurrency claim. The next validation checkpoint is separately authorized `journal.append` production wiring with durable and live evidence gates.
