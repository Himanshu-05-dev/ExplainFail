# EXPLAINFAIL — Production Build Plan (v2: "Works with AI tools, CI and the community")

> **Audience:** an AI coding agent (Antigravity) implementing v2.
> **Prerequisite:** v1 is fully built, `npm test` is green, and `EXPLAINFAIL_V1_PLAN.md` (the v1 plan) is placed in the repo at `docs/V1_PLAN.md`. This document refers to it as **"V1 plan"** with section numbers. Everything in the V1 plan still applies unless this document explicitly changes it.
> **Target version:** `0.2.0`.
> Everything here is already decided. Do not redesign it.

---

## 0. RULES FOR THE AI AGENT (READ FIRST, OBEY ALWAYS)

1. **Build only what is written here.** No extra features, commands, flags, config files or dependencies. Unclear? Write it to `OPEN_QUESTIONS.md` and choose the **most conservative** behavior (do less).
2. **No LLM/AI calls inside explainfail.** v2 lets *other* AI tools call explainfail. explainfail itself still contains no AI code. (AI inside explainfail is v3, a separate plan.)
3. **All V1 guarantees stay:** evidence-before-diagnosis, no fix without permission, redaction of secrets, `.env` values never read, no telemetry.
4. **Do not break v1.** Every v1 test must keep passing, unchanged, after every milestone.
5. **Never trust memory for external APIs** (MCP SDK, GitHub Actions, `gh` CLI). These change. Before using one, read its **current official documentation** and record what you chose in `docs/DECISIONS.md` (name, version, reason).
6. **Never invent test fixtures** from memory (V1 plan Rule 4 applies). Mark unavoidable synthetic ones `"synthetic": true` and list them in the final report.
7. Work in the milestone order of Section 9. Run `npm test` after each. Do not implement Section 11 (Out of scope).
8. When finished, produce the **final report**: what was built, tests passing, synthetic fixtures, decisions in `docs/DECISIONS.md`, and `OPEN_QUESTIONS.md`.

---

## 1. WHAT v2 ADDS (EXACTLY THREE THINGS + ONE REFACTOR)

| # | Item | Purpose |
|---|---|---|
| R | **Core API refactor** (no behavior change) | MCP server and Action reuse the engine without CLI printing/prompting |
| 1 | **MCP server** (`explainfail mcp`) | AI IDEs (Claude Code, Cursor, Antigravity, etc.) can ask explainfail for *facts* instead of guessing |
| 2 | **GitHub Action** | On CI failure, post explainfail's evidence to the PR/step summary |
| 3 | **Plugin loading** | Community can add detectors (`explainfail-plugin-*`) |

New CLI surface (only this): the `explainfail mcp` command, the `--plugin <name|path>` flag (repeatable, on run/doctor/verify), and `report --markdown`.

---

## 2. TECH DECISIONS

| Item | Decision |
|---|---|
| New dependencies | **MCP SDK** + its required schema library (`zod`). Nothing else. |
| MCP SDK version | Check npm **at implementation time**. Use the latest **stable** release. The official SDK has had two lines (v1.x: package `@modelcontextprotocol/sdk` with zod v3; v2: package `@modelcontextprotocol/server` with zod v4). If v2 is not stable yet, use v1.x. Pin the exact version. Record in `docs/DECISIONS.md`. |
| Transport | **stdio only.** (stdout = protocol; see Rule in 4.1.) No HTTP server. |
| Action type | **Composite action** (`action.yml`, shell steps). No bundled JS action. |
| Node | unchanged (`>=18.17`; if the chosen MCP SDK needs a higher Node, STOP and ask the human). |

---

## 3. MILESTONE R — CORE API REFACTOR (do this first)

Create `src/api.js` exposing **pure, data-returning** functions. They must never print, prompt, or call `process.exit`.

```js
analyzeOutput({ cwd, output, command?, exitCode? }) -> { fingerprint, diagnoses, unknown }
runCommand({ cwd, argv|shell, timeoutSec, onOutput? }) -> { exitCode, signal, output, fingerprint, stayedUp }
verifyCommand({ cwd, command, baseline?, also?, timeoutSec }) -> VerifyResult   // same object as `verify --json`
runDoctor({ cwd }) -> { findings, skipped }
buildReport({ cwd, format: 'for-ai'|'markdown'|'json' }) -> string|object
```
- The CLI (`cli.js`, `loop.js`, `doctor.js`, `verify.js`, `report.js`) is rewritten to call these functions. User-visible CLI behavior must be **byte-for-byte identical** (use v1 e2e tests as proof).
- `analyzeOutput` takes output text directly (no process running) and performs detector `match` + `gather` (read-only checks) + `explain` + `fixes`.
- Add `test/api.test.js`.

*Accept:* all v1 tests pass unchanged; `api.test.js` passes.

---

## 4. MCP SERVER

### 4.1 Command and hard rules
- `explainfail mcp` starts an MCP server over **stdio** (a local process launched by the AI tool; not an internet server).
- **stdout belongs to the protocol.** Nothing else may ever write to stdout in `mcp` mode (no logs, no tee of child output, no chalk). Logs → **stderr** only. Child process output is captured, never teed. Add a test that scans stdout of a full session and asserts it contains only valid protocol messages.
- The server name is `explainfail`; version read from `package.json`.
- The MCP server **never applies fixes** and never prompts. It returns facts and suggestions as data.

### 4.2 Tool 1: `explainfail_diagnose` (read-only)
Input schema:
- `output` (string, required): the error output text the AI saw. Max 200 KB (truncate from the start, keep the tail).
- `cwd` (string, optional): project directory. Default: the directory the server was launched in. Must be inside the launch directory (path-containment check, resolve symlinks), else error.
- `command` (string[], optional): the argv that failed (used only for context, e.g. which package manager command failed).

Behavior: `api.analyzeOutput(...)`. It does **not** run any command.
Output (JSON text content; also structured output if the chosen SDK supports it):
```json
{
  "unknown": false,
  "fingerprint": { "exitCode": null, "errorCode": "EADDRINUSE", "errorLine": "...", "tailHash": "...", "detectorIds": ["port-in-use"] },
  "diagnoses": [
    { "detectorId": "port-in-use", "title": "Port already in use", "kind": "cause",
      "evidence": [{"label":"PID","value":"4821"}],
      "explanation": "...",
      "fixes": [{ "id":"...", "label":"...", "type":"command|file|manual", "risk":"low|medium",
                  "argv": ["..."], "manualText": "...", "warning": "..." }] }
  ]
}
```
When no rule matches with evidence: `{ "unknown": true, "diagnoses": [], "message": "explainfail could not confirm a cause for this failure. No rule matched with evidence." }` (exact V1 wording). The AI must not be handed a guess.
All strings pass through `redact()`.

### 4.3 Tool 2: `explainfail_verify`
Runs a command and reports facts, exactly like `explainfail verify --json` (V1 plan Section 6.3).
Input schema:
- `command` (string[], required): **argv array**, never a shell string.
- `cwd` (string, optional): same containment rule as above.
- `baseline` (Fingerprint object, optional): fingerprint from a previous failure. If omitted, use `.explainfail/last-failure.json` when its command matches.
- `also` (string[][], optional): extra argv commands to run after the main command passes.
- `timeoutSec` (number, optional): default 60, minimum 1, maximum 600.

Security rules (enforced and tested):
1. `command[0]` and each `also[i][0]` must be one of: `npm`, `npx`, `yarn`, `pnpm`, `bun`, `node`. Anything else → tool error "executable not allowed".
2. Executed with `shell: false`.
3. One verify at a time (mutex). If busy → tool error "another verification is running".
4. Output excerpt returned is at most 8 KB, last lines, redacted.
5. Document honestly (README): `npm run <script>` can run arbitrary scripts defined in the project, so this allowlist limits explainfail's own surface, it is **not** a sandbox.

Output: the V1 `verify --json` object `{status, command, exitCode, fingerprint, baselineFingerprint, detectorsMatched, also}` plus `outputExcerpt`.
Status values: `PASS`, `STAYED_UP`, `SAME_ERROR`, `NEW_ERROR` (same meaning as V1).

Tool annotations: `explainfail_diagnose` read-only; `explainfail_verify` not read-only (it executes commands), not open-world. Check the exact annotation field names in the chosen SDK's current docs.

### 4.4 Docs to create (documentation only, not code)
- `docs/MCP_SETUP.md`: how to register the server in AI tools. Command is `npx -y explainfail mcp`. Provide the generic JSON form (`{"mcpServers":{"explainfail":{"command":"npx","args":["-y","explainfail","mcp"]}}}`) and the Claude Code CLI form. For each tool you document (Claude Code, Cursor, VS Code, Antigravity), **verify the current setup steps in that tool's official docs**; if you cannot verify one, say "check the tool's MCP documentation" instead of inventing steps.
- `docs/AI_RULES_SNIPPET.md`: a text block users paste into their AI tool's rules/instructions file:
  > Before telling the user that a command, build, or test is fixed, call `explainfail_verify` with the exact failing command and report its `status` verbatim. Only say "fixed" if status is `PASS`. When an error appears, call `explainfail_diagnose` with the error output first. If it returns `unknown: true`, say you are not certain of the cause; do not present a guess as a diagnosis.

*Accept:* the MCP Inspector (`npx @modelcontextprotocol/inspector npx explainfail mcp` or the equivalent in current docs) lists both tools and returns valid results.

---

## 5. GITHUB ACTION

### 5.1 `report --markdown` (new flag, in CLI and `api.buildReport`)
Output format (exact structure):
```
<!-- explainfail-comment -->
## explainfail: `<command>` failed (exit <n>)

### <Diagnosis title> — <cause|finding>
**Evidence**
- <label>: <value>

**Explanation**
<text>

**Suggested fix** (risk: <low|medium|manual>)
<argv in a code span, or manualText>
<warning if any>

---
Run `npx explainfail <command>` locally to apply a fix with your permission.
```
One `###` block per diagnosis. If none: print the V1 UNKNOWN wording and the last error line. All text redacted. The first line must be exactly `<!-- explainfail-comment -->` (used to find the sticky comment).

### 5.2 `action.yml` (repo root, composite)
Inputs:
- `command` (required): the command to run.
- `working-directory` (default `.`).
- `comment` (default `true`): post/update a PR comment.
- `github-token` (default `${{ github.token }}`).
- `explainfail-version` (default: the exact current `package.json` version, updated at each release; never `latest`).

Steps, in order:
1. Run: `npx -y explainfail@<explainfail-version> --no-fix "$WF_COMMAND"` where `WF_COMMAND` is passed via `env:` (**never** interpolate `${{ inputs.command }}` directly inside the script; prevents script injection). Capture the exit code, do not stop yet.
2. `npx -y explainfail@<version> report --markdown > "$RUNNER_TEMP/explainfail.md"` (only if step 1 failed).
3. Append the markdown to `$GITHUB_STEP_SUMMARY`.
4. If `comment` is `true` and the event is a pull request and the token can write: create or update **one sticky comment**, found by the `<!-- explainfail-comment -->` marker, using the `gh` CLI / `gh api` (preinstalled on GitHub-hosted runners). Verify the exact `gh` syntax in current docs before using it. If posting fails (for example fork PRs with a read-only token), emit a **warning**, never fail the job because of the comment.
5. Exit with the **exit code of the user's command** from step 1.

Rules: never pass `--yes`; never apply fixes in CI; no third-party actions (no `uses:` of other actions); document the needed permission `pull-requests: write` and warn in the README **not** to use it with `pull_request_target` on untrusted code.

### 5.3 Tests
- `scripts/test-action-steps.sh`: runs the step logic locally with a fake `gh` and fake env, asserting: injection attempt in command string is not executed, exit code is propagated, sticky comment logic (create vs update) is called correctly, comment failure does not change the exit code.
- `.github/workflows/test-action.yml` in this repo: runs the action (`uses: ./`) against a deliberately failing sample with `continue-on-error: true` and asserts the step summary was written.
- Unit tests for `report --markdown` (fixtures for diagnosis and unknown).

---

## 6. PLUGINS

### 6.1 Contract
A plugin is an npm package named `explainfail-plugin-<name>` (or a local path) whose default export is:
```js
export default {
  apiVersion: 1,                // must equal EXPLAINFAIL_PLUGIN_API (exported constant, value 1)
  name: 'docker',               // short name, [a-z0-9-]+
  detectors: [ /* Detector objects exactly as V1 plan Section 5.2 */ ]
};
```
Expose a helper via `package.json` `"exports"`: `"./plugin"` → `./src/plugin-api.js`, exporting `EXPLAINFAIL_PLUGIN_API` and `defineDetector(detector)` (validates the shape, returns it unchanged). Keep existing `bin` working.

### 6.2 Loading (explicit opt-in only; no auto-discovery)
- Sources: the project's `package.json` field `"explainfail": { "plugins": ["explainfail-plugin-docker"] }` **or** repeatable CLI flag `--plugin <name|path>`. This field is the **only** configuration explainfail has. No other config files.
- Resolve package names **from the project (cwd)**, not from explainfail's own install location (important for `npx`). Use `createRequire` anchored at `<cwd>/package.json`, then dynamic `import(pathToFileURL(...))`.
- Plugin detectors run **after** the 8 built-ins.

### 6.3 Safety rules (enforced and tested)
1. A plugin that fails to load, has the wrong `apiVersion`, or an invalid shape → print one warning line and continue; never crash explainfail.
2. Each plugin detector's `match`/`gather`/`explain`/`fixes`/`preflight` is wrapped in try/catch and a **5-second timeout**. Failure → warning, no diagnosis.
3. Detector `id` must be `"<plugin name>/<id>"` (prefixed). Collision with a built-in id → plugin detector rejected.
4. The **evidence rule** (V1 plan 5.3) applies to plugins exactly the same.
5. A fix with `risk: 'high'` → rejected. Fix `type` must be `command`, `file` or `manual`.
6. Permission prompt for plugin fixes shows `[plugin: <name>]` and the exact argv/files. **`--yes` never auto-approves plugin fixes**, even `low` risk.
7. Plugin fixes cannot bypass the V1 rules: no `sudo`, no `shell: true`.

### 6.4 Deliverables
- `docs/WRITING_A_PLUGIN.md`: contract, example, testing advice, safety rules above.
- `examples/explainfail-plugin-example/` (not published): one small, real detector (e.g. detects a missing `.nvmrc` when `engines.node` exists, as a `finding`) with its own test.
- Do **not** write real community plugins (docker, python, etc.). That is out of scope.

---

## 7. TESTING REQUIREMENTS (in addition to V1)

1. `api.test.js`: each API function returns data and does not print or exit.
2. **MCP:** protocol test with an in-process or spawned client (use the SDK's client) covering: both tools listed; `explainfail_diagnose` on real fixture outputs from V1 (`port-in-use`, `module-not-found`) returns evidence; unknown output returns `unknown: true`; `explainfail_verify` PASS and SAME_ERROR; disallowed executable rejected; `cwd` escaping the launch directory rejected (including via symlink); busy mutex; stdout purity test.
3. **Action:** Section 5.3.
4. **Plugins:** valid plugin loads and its diagnosis appears; wrong `apiVersion` warns and continues; throwing plugin does not crash; slow plugin hits the 5 s timeout (use a short test timeout override); evidence-less plugin diagnosis dropped; `risk: 'high'` rejected; `--yes` does not approve plugin fixes; id prefix and collision rules; resolution from `cwd` works when explainfail runs from another location.
5. All v1 tests still pass.

---

## 8. README UPDATES

Add sections: "Use with AI tools (MCP)" (link `docs/MCP_SETUP.md` + the rules snippet), "Use in CI (GitHub Action)", "Writing plugins". Add honest limitations:
- MCP tools give facts and suggestions; they **do not apply fixes**.
- `explainfail_verify` allowlist is not a sandbox.
- The Action never fixes anything in CI; it reports.
- Plugins are third-party code; install only plugins you trust.
Bump version to `0.2.0`; add a CHANGELOG entry.

---

## 9. MILESTONES (IN THIS ORDER; TEST AFTER EACH)

- **M-R:** Core API refactor (Section 3).
- **M1:** MCP server + both tools + docs (Section 4).
- **M2:** `report --markdown` + `action.yml` + Action tests (Section 5).
- **M3:** Plugin API, loading, safety rules, docs, example plugin (Section 6).
- **M4:** README, CHANGELOG, version bump, `npm pack --dry-run` shows only `bin`, `src`, `README.md`, `LICENSE`, `package.json`, `action.yml`, `docs`; final report.

---

## 10. DEFINITION OF DONE (v2)

- [ ] All v1 tests pass unchanged; all new tests pass offline.
- [ ] CLI behavior identical to v1 apart from the three additions.
- [ ] MCP server: two tools only; stdout purity test passes; no fix is ever applied through MCP.
- [ ] `explainfail_verify` enforces the executable allowlist, argv-only, cwd containment, mutex, output cap.
- [ ] Action: no script injection, exit code of user's command propagated, comment failure never fails the job, no third-party actions.
- [ ] Plugins: all safety rules in 6.3 enforced and tested; `--yes` never approves plugin fixes.
- [ ] Only MCP SDK + zod added as dependencies; choice recorded in `docs/DECISIONS.md`.
- [ ] No AI/LLM code inside explainfail; no telemetry.
- [ ] README honest limitations updated.
- [ ] Final report delivered.

---

## 11. OUT OF SCOPE FOR v2 — DO NOT BUILD

- HTTP/remote MCP transport, authentication, MCP resources/prompts, an MCP tool that applies fixes.
- Any AI/LLM adapter or patch generation (that is v3).
- Plugin marketplace/registry, automatic plugin discovery, real community plugins.
- Other CI providers (GitLab, CircleCI, etc.), a bundled JS action.
- Any new detectors beyond the 8 built-in ones.
