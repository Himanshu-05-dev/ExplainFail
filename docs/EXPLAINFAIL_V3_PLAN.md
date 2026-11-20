# EXPLAINFAIL — Production Build Plan (v3: "Opt-in AI fix loop, explainfail is the judge")

> **Audience:** an AI coding agent (Antigravity) implementing v3.
> **Prerequisites:** v1 complete (`docs/V1_PLAN.md`) and v2 complete at least through **Milestone R** (core API, `docs/V2_PLAN.md`). `npm test` is green. This document refers to them as **"V1 plan"** and **"V2 plan"**. Everything in them still applies unless this document explicitly changes it.
> **Target version:** `0.3.0`.
> Everything here is already decided. Do not redesign it.

---

## 0. RULES FOR THE AI AGENT (READ FIRST, OBEY ALWAYS)

1. **Build only what is written here.** No extra commands, flags, adapters, dependencies. Unclear? Write to `OPEN_QUESTIONS.md` and choose the **most conservative** behavior (do less, ask the human, reject the patch).
2. **AI is opt-in and lives only in the new `explainfail fix` command.** `explainfail <command>`, `doctor`, `verify`, `report`, and the MCP server must never call any AI. A test must prove this (Section 13, item 12).
3. **The AI proposes. explainfail judges.** Success is decided only by re-running the real command (exit code + fingerprint comparison, V1 plan Section 10). The AI's own claims ("fixed") are ignored.
4. **No new npm dependencies.** Use Node's built-in `fetch`, `child_process`, `crypto`, `fs`, `readline`. If you believe one is required, STOP and ask.
5. **Never send data to any AI without the user's consent** (Section 9). Never log or store API keys.
6. **Never invent model names.** The model is always supplied by the user. No default model id in code.
7. **Never fabricate fixtures.** Real captured outputs only (V1 plan Rule 4); synthetic ones flagged and listed in the final report.
8. Work in the milestone order of Section 14. Run `npm test` after each. Do not implement Section 16 (Out of scope).
9. When finished, produce the **final report**: what was built, tests passing, synthetic fixtures, `OPEN_QUESTIONS.md`, and a list of any behavior you were unsure about.

---

## 1. PRODUCT STATEMENT

`explainfail fix <command>` extends the v1 loop: when no deterministic rule can fix the failure, explainfail may ask an AI (the user's own provider, user's own key) for a **diff only**. explainfail then **validates the diff**, shows it, asks permission, applies it with a backup, **re-runs the same command**, and **auto-reverts** if it failed or caused a regression.

Honest claim for README and marketing: **"Hallucinated or bad fixes are caught by real re-runs and reverted."** Never claim "no hallucinations".

---

## 2. SCOPE

### IN
- New command `explainfail fix <command...>`.
- AI adapters: `command`, `openai-compatible`, `anthropic` (Section 8).
- Context packer (small, relevant, redacted context; Section 6).
- Diff parser/validator with hallucination and cheating guards (Section 7).
- Consent screen, budgets, session revert (Sections 9–10).
- Tests with a fake AI (Section 13).

### OUT (do NOT build)
- Autonomous agent behavior, multi-file refactors, new-file creation by AI, dependency installation by AI, editing tests/lockfiles/`package.json`/CI files, MCP "apply fix" tool, streaming UI, cost estimates in currency, auto-detection of which AI CLI is installed.

---

## 3. NEW CLI SURFACE (ONLY THIS)

```
explainfail fix [options] <command...>
```
Options:
- `--ai <adapter>` (required): `command` | `openai-compatible` | `anthropic`.
- `--model <id>`: required for `openai-compatible` and `anthropic`. No default.
- `--ai-cmd "<shell command>"`: required for `command` adapter.
- `--base-url <url>`: for `openai-compatible` (default read from env `EXPLAINFAIL_AI_BASE_URL`; no hardcoded default).
- `--consent-send`: skip the consent prompt (required in non-interactive use).
- `--max-rounds <n>`: total rounds including rule-based ones, default `5`.
- `--max-ai-calls <n>`: default `3`.
- `--max-diff-lines <n>`: default `60` (added + removed lines).
- `--max-context-kb <n>`: default `60`.
- `--max-output-tokens <n>`: default `2000` (API adapters).
- `--also "<command>"` (repeatable), `--verify-timeout <sec>`, `--dry-run` (shows the context that would be sent and stops; sends nothing).

`--yes` is **not accepted** by `fix` for AI patches (an AI patch is never auto-approved). Rule-based fixes inside `fix` follow V1 rules (`--yes` is not offered here to avoid confusion: prompts only).

API keys come **only from environment variables**: `ANTHROPIC_API_KEY` (anthropic), `OPENAI_API_KEY` (openai-compatible; `EXPLAINFAIL_AI_API_KEY` accepted as an alternative). Keys are never accepted as CLI flags (shell history leak) and never written to logs.

Exit code: exit code of the final run of the user's command. Internal error: `70`.

---

## 4. REPOSITORY ADDITIONS

```
src/
├─ fix/
│  ├─ fix-loop.js          # the loop (Section 5)
│  ├─ context-pack.js      # Section 6
│  ├─ prompt.js            # system prompt text (Section 6.3)
│  ├─ diff-parse.js        # unified diff parser
│  ├─ diff-validate.js     # Section 7
│  ├─ diff-apply.js        # strict apply + syntax check
│  ├─ consent.js           # Section 9
│  └─ budget.js            # Section 10
└─ ai/
   ├─ adapter.js           # interface + registry
   ├─ command-adapter.js
   ├─ openai-compatible-adapter.js
   └─ anthropic-adapter.js
test/
├─ fix/*.test.js
├─ ai/*.test.js
└─ fixtures/ai/            # canned AI responses (diffs, NO_FIX, garbage) and mock projects
docs/
└─ AI_MODE.md
```

---

## 5. THE FIX LOOP (`fix-loop.js`)

Reuses V1 pieces (`runCommand`, fingerprint, engine, backup). One **round** = steps 1–10.

```
session = { startedAt, backups: [], attempts: [], aiCalls: 0 }
LOOP (until PASS or limit):
 1. RUN the command. If exit 0 → PASS → go to step 11.
 2. Fingerprint F_before. Save last-failure.json (V1 rules).
 3. DIAGNOSE with the deterministic engine (V1).
 4. RULES FIRST: if there is a `cause` diagnosis having a command/file fix NOT already tried in this
    session → run the normal V1 permission/apply/verify path for that fix and continue the loop.
    (AI is NOT consulted while an untried rule-based fix exists.)
 5. Otherwise AI STEP:
    a. Budget check (Section 10). Exhausted → STOP.
    b. Build context (Section 6). Show CONSENT screen once per session (Section 9).
    c. Call the adapter with { system, user }. aiCalls += 1.
    d. Parse response: literal `NO_FIX: <reason>` → print reason, STOP (no guessing).
       Otherwise extract exactly ONE fenced ```diff block. None or more than one → reject, count as a failed attempt.
    e. VALIDATE the diff (Section 7). Any REJECT → print the rejection reasons, record attempt, next round
       (tell the AI what was rejected and why in "Already tried").
    f. Show: files touched, +/- line counts, any WARNINGS, and the diff. Prompt:
       "Apply this AI-proposed patch? (y/N)". Default No. Declined → STOP.
    g. BACKUP touched files (V1 backup.js) → APPLY strictly (diff-apply.js) → SYNTAX CHECK (Section 7.4).
       Syntax check fails → restore immediately, record attempt FAILED_SYNTAX, next round.
 6. RE-RUN THE SAME COMMAND (V1 step 10 semantics, including --verify-timeout / STAYED_UP).
 7. COMPARE fingerprints:
    - PASS      → run each --also command. Any failure → status REGRESSION → AUTO-REVERT this patch.
    - STAYED_UP → report as V1 (not claimed as fixed). Keep the patch; STOP.
    - SAME_ERROR→ AUTO-REVERT this patch (restore backup). Record attempt, next round.
    - NEW_ERROR → keep the patch (the original error is gone). Record attempt. Next round uses the NEW error.
 8. STUCK CHECK: if the AI proposes a diff whose hash equals one already tried → STOP ("AI repeated a failed patch").
 9. Rounds > --max-rounds → STOP.
10. Write the run log (V1 Section 13) with each attempt: `{round, source:'rule'|'ai', diffHash, files, result}`.
11. END OF SESSION:
    - PASS: print chain summary (what was changed, in which order). Done.
    - Not PASS and ≥1 patch was kept: ask "Revert ALL changes made in this session? (y/N)".
      Yes → restore every backup of the session in reverse order.
```
Notes:
- Non-interactive (no TTY): `fix` never applies AI patches (it needs a human `y`). It prints the validated diff and exits with the failing command's exit code.
- A user Ctrl+C during any step restores the in-flight patch if it was applied but not yet verified, then exits.

---

## 6. CONTEXT PACKER (`context-pack.js`) — THE ANTI-HALLUCINATION CORE

Goal: give the AI **small, relevant, verified** context, never the whole repo.

### 6.1 What goes in (in this priority order, stop when `--max-context-kb` is reached)
1. **Task header:** the command, exit code, fingerprint errorCode/errorLine.
2. **Verified facts** from the deterministic engine (evidence lines, V1 `report --for-ai` facts) with `[cause]/[finding]` tags.
3. **Error output:** last 80 lines, redacted.
4. **Source excerpts:** extract file paths from stack traces and error lines (patterns like `at … (<path>:<line>:<col>)`, `<path>:<line>:<col>`, `file://…`). Keep only paths **inside the project root**, not in `node_modules`, in order of first appearance, **max 5 files**. For each: if the file ≤ 300 lines include it whole; otherwise include lines `[line-40, line+40]` plus the first 20 lines (imports). Every excerpt is prefixed with its path and `lines a–b of N`, and numbered.
5. **Direct imports:** for those files, resolve relative `import`/`require` specifiers to existing project files, **max 3 files, first 80 lines each**, labeled `PARTIAL`.
6. **Project facts:** `package.json` `scripts`, `dependencies`, `devDependencies`, `engines` (names + ranges only); the first 200 lines of any of: `tsconfig.json`, `vite.config.*`, `next.config.*`, `webpack.config.*`, `.eslintrc*`, `eslint.config.*` that exist.
7. **Environment:** OS, Node version, package manager, lockfile present, `node_modules` present.
8. **Already tried:** every attempt so far (source, files, short diff summary, result, rejection reasons).

### 6.2 Never included
`.env*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `credentials*`, anything under `.git`, `.explainfail`, `node_modules`. All text passes through `redact()` (V1 plan Section 14). Test files **may** be included as read-only context (they are protected from edits, Section 7.1).

### 6.3 System prompt (exact text, stored in `prompt.js`, versioned by a constant `PROMPT_VERSION`)
```
You are a careful code-fixing assistant. You are given a failing command, its error output,
verified facts from a diagnostic tool, and excerpts of project files.

Rules:
1. Respond with EITHER exactly one fenced ```diff block containing a unified diff, OR a single line
   starting with "NO_FIX:" followed by a short reason. Output nothing else.
2. Use ONLY the files and line contents shown to you. Do not invent file paths, function names,
   packages, or APIs. If you cannot fix the problem with the information given, answer NO_FIX.
3. Make the smallest possible change that fixes the root cause.
4. Do NOT modify: test files, lockfiles, package.json, .env files, CI configuration, or anything
   under node_modules.
5. Do NOT hide the error: no eslint-disable, @ts-ignore, @ts-nocheck, @ts-expect-error, empty catch blocks,
   skipped tests, or process.exit(0).
6. Do NOT add imports of packages that are not already listed in package.json.
7. Context lines and removed lines in your diff must match the shown file contents exactly.
8. Do not repeat a patch listed under "Already tried".
```

---

## 7. DIFF VALIDATION (`diff-validate.js`) — all checks are deterministic

Input: raw diff text + project root. Output: `{ ok, rejections[], warnings[], files[], addedLines, removedLines, hash }`.

### 7.1 Path rules (REJECT on violation)
- Relative paths only; no `..`, no absolute paths, no drive letters; after resolving (including symlinks) must stay inside the project root.
- Target file **must exist** (v3 does not let the AI create or delete files).
- Max **3 files** per patch.
- **Protected globs** (REJECT): `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `**/test/**`, `**/tests/**`, lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`), `package.json`, `.env*`, `.github/**`, `.gitlab-ci.yml`, `node_modules/**`, `.git/**`, `.explainfail/**`.

### 7.2 Hunk rules (REJECT on violation)
- For every hunk, all context lines and removed lines must match the current file **exactly** (including whitespace) at the stated position. If the stated position does not match, allow search within ±3 lines for a **unique** exact match; if not found or not unique → REJECT ("old lines do not match the file; likely hallucination").
- Total changed lines (added + removed) ≤ `--max-diff-lines`.

### 7.3 Cheating & hallucination guards
REJECT if any **added** line matches (case-sensitive unless noted):
`eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `istanbul ignore`, `process.exit(0)`, `.skip(` / `xit(` / `xdescribe(` / `it.skip` / `test.skip`, empty catch (`catch\s*(\([^)]*\))?\s*\{\s*\}`).
REJECT if an added line imports/requires a **bare package name** that is not (a) listed in `package.json` dependencies/devDependencies/optionalDependencies, (b) a Node builtin (`require('module').builtinModules`, with or without `node:`), or (c) already imported elsewhere in the same file's unchanged lines. Message: "unknown package; hallucination risk".
REJECT if an added line imports a **relative path** that does not resolve to an existing project file (try the given path plus `.js .mjs .cjs .ts .tsx .jsx .json /index.*`) after the patch is applied.
WARN (not reject; shown prominently, user must still say `y`): the diff **removes** lines matching `\b(throw|assert|expect)\b`; the diff changes > 1 file; the diff touches config files (`*.config.*`, `tsconfig.json`).

### 7.4 Syntax check after apply (`diff-apply.js`)
- `.js .mjs .cjs`: run `node --check <file>` (argv, no shell).
- `.json`: `JSON.parse`.
- Other extensions (`.ts`, `.tsx`, `.jsx`, etc.): skip (the real command re-run is the judge).
- Failure → immediate restore from backup.

`hash` = SHA-1 of the normalized diff (used for the stuck check).

---

## 8. AI ADAPTERS

Interface (`adapter.js`):
```js
// async propose({ system: string, user: string, signal: AbortSignal, maxOutputTokens: number })
//   -> { text: string, usage?: { inputTokens?: number, outputTokens?: number } }
```
Common rules: 120-second timeout via `AbortSignal`; on HTTP/network error → clear message, counts as a failed AI call, **no retry loops**; never log headers or keys.

1. **`anthropic`**: HTTPS POST to the Anthropic Messages API using `fetch` (no SDK). Check the **current official API docs** for endpoint, required headers (API key header, version header) and body shape before implementing; record in `docs/DECISIONS.md`. Key from `ANTHROPIC_API_KEY`; `--model` required.
2. **`openai-compatible`**: POST to `<base-url>/chat/completions`-style endpoint (verify the current standard path in docs). `--base-url` or `EXPLAINFAIL_AI_BASE_URL` required; key from `OPENAI_API_KEY` or `EXPLAINFAIL_AI_API_KEY` (optional for local servers that need none); `--model` required. Works for OpenAI and local servers exposing the same API.
3. **`command`**: runs the user's `--ai-cmd` as a shell string. Prompt (system + user, separated by clear delimiter lines) is written to **stdin**; **stdout** is the response. 180 s timeout. Intended for any CLI that can run non-interactively in text-in/text-out mode. **Before** the call, hash the project file tree (exclude `node_modules`, `.git`, `.explainfail`, `dist`, `build`); **after**, hash again. If anything changed → STOP immediately, list the changed files, and tell the user: "The AI command edited files directly. explainfail needs diff-only output. Review with `git diff`." (explainfail cannot auto-revert here; document the risk and recommend a clean git tree.)

---

## 9. CONSENT (`consent.js`)

Before the **first** AI call of a session, print and ask (unless `--consent-send`):
```
explainfail will send the following to <adapter/provider host> using YOUR credentials:
  - error output (last 80 lines, secrets redacted)
  - N project files (list each path) ≈ <size> KB
  - package.json dependency names
It will NOT send: .env files, keys, node_modules, git history.
Send? (y/N)
```
`--dry-run` prints the full context and the exact list above, then exits without sending. Declined → no adapter call is made (tested). Non-interactive without `--consent-send` → no call.

---

## 10. BUDGETS (`budget.js`)

Stop conditions (checked before each AI call): `aiCalls >= --max-ai-calls`, `rounds > --max-rounds`, context larger than `--max-context-kb` (trim by priority order of 6.1; never exceed). After each call print bytes sent and, if the provider returned usage, token counts. **Do not print money estimates** (prices change). Always end with a one-line summary: rounds used, AI calls used, patches kept/reverted.

---

## 11. RUN LOG ADDITIONS (extends V1 Section 13)

- `.explainfail/ai/<timestamp>-<round>-prompt.txt` (redacted exact prompt sent) and `-response.txt` (redacted response), for auditability. Never store keys or headers.
- Run log `rounds[].attempts[]`: `{source, diffHash, files, addedLines, removedLines, warnings, result}`.
- Retention: same 20-run cap.

---

## 12. SECURITY & PRIVACY

- Keys from environment only; never printed, logged, or put in the prompt.
- Everything sent is redacted and shown/consented first.
- Diffs are applied only through `diff-apply.js` (never by evaluating AI text as shell or code).
- AI output is **never** executed as a command. The only commands explainfail runs are (a) the user's original command, (b) V1 whitelisted fixes, (c) `node --check`, (d) the user's own `--ai-cmd`.
- Document in README: code excerpts leave the machine when an API adapter is used; choose a local server (`openai-compatible` with a local base URL) if that is unacceptable.

---

## 13. TESTING REQUIREMENTS (all offline and deterministic)

Use a **fake AI**: a `command`-adapter script that prints canned responses from `test/fixtures/ai/`. HTTP adapters are tested against a local mock server (`node:http`) that asserts headers and body shape.

1. `diff-parse`: valid diff, multiple files, malformed diff, two diff blocks, no block, `NO_FIX`.
2. `diff-validate` (one test per rule): path traversal, absolute path, symlink escape, missing file, >3 files, each protected glob, old-lines mismatch, unique-offset match (±3), non-unique match, over `--max-diff-lines`, each cheating pattern, unknown package import, builtin import allowed, listed package allowed, non-existent relative import, each WARN case.
3. `diff-apply`: strict apply result equals expected bytes; syntax check failure restores; JSON invalid restores.
4. `context-pack`: stack trace → correct files and windows; `node_modules` and outside-root paths excluded; secret files excluded; budget trimming order; redaction applied; import resolution limit.
5. `consent`: declining → adapter never called (assert with a spy); non-interactive without `--consent-send` → never called; `--dry-run` sends nothing.
6. **Loop e2e with the fake AI** (real projects in a temp dir with a real failing command):
   - success: AI patch → PASS.
   - AI patch → SAME_ERROR → auto-revert (file bytes identical to original).
   - AI patch → NEW_ERROR → kept, next round uses the new error.
   - AI patch → PASS but `--also` fails → REGRESSION → auto-revert.
   - rejected diff (e.g., touches a test file) → never applied; rejection reason fed into the next prompt's "Already tried".
   - repeated identical diff → stuck stop.
   - `NO_FIX` → stops, nothing changed.
   - budget stops (`--max-ai-calls 1`).
   - rule-based fix available → AI is **not** called (spy).
   - end-of-session "revert all" restores the original tree (hash compare).
   - Ctrl+C mid-verify restores the patch.
   - non-interactive → no patch applied.
7. Adapters: `anthropic` and `openai-compatible` request shape against mock server; key appears only in the auth header, never in logs/run files (grep test); timeout handling; HTTP 401/429/500 → clean failure; `command` adapter detects direct file edits and stops.
8. **No AI outside `fix`:** a test that runs `explainfail <cmd>`, `doctor`, `verify`, `report` and the MCP server with an adapter spy/network blocker and asserts zero AI calls and zero network usage.
9. `PROMPT_VERSION` snapshot test: the system prompt equals the exact text of Section 6.3.
10. All V1 and V2 tests still pass.

---

## 14. MILESTONES (IN THIS ORDER; TEST AFTER EACH)

- **M1:** `diff-parse`, `diff-validate`, `diff-apply` with full tests (no AI, no network yet).
- **M2:** `context-pack` and `prompt.js` with tests.
- **M3:** `consent`, `budget`, adapter interface, **`command` adapter** and the fake-AI test harness.
- **M4:** `fix-loop` + `explainfail fix` wiring + all loop e2e tests (using the `command` adapter).
- **M5:** `anthropic` and `openai-compatible` adapters + mock-server tests.
- **M6:** run-log additions, `docs/AI_MODE.md`, README updates, version `0.3.0`, CHANGELOG, `npm pack --dry-run` check, final report.

---

## 15. README / DOCS UPDATES

`docs/AI_MODE.md` + README section "AI fix mode (opt-in)": how to run (`explainfail fix --ai anthropic --model <id> npm run dev`), what is sent, consent, budgets, how revert works. Honest limitations (copy):
- Exit code 0 means the command ran without a known error. It does not prove the patch is logically correct.
- Rules run first; AI is used only when no deterministic fix applies.
- Patches may be rejected often; that is intended.
- With API adapters, code excerpts leave your machine. Use a local OpenAI-compatible server if that is a problem.
- The `command` adapter cannot be safely sandboxed; if the tool edits files by itself, explainfail stops and cannot auto-revert.
- Costs depend on your provider; explainfail only enforces call/size limits.
- Hallucinations are **caught and reverted**, not prevented.

---

## 16. OUT OF SCOPE FOR v3 — DO NOT BUILD

- AI creating/deleting files, installing packages, editing tests/lockfiles/`package.json`/CI/`.env`.
- Multiple parallel AI calls, streaming output, long-term memory, caching AI responses.
- Auto-selecting or auto-installing an AI tool; default model names; currency cost estimates.
- AI features in `run`, `doctor`, `verify`, `report`, MCP, or the GitHub Action.
- A web UI or editor extension.

---

## 17. DEFINITION OF DONE (v3)

- [ ] All v1, v2 and new tests pass offline.
- [ ] `explainfail fix` is the **only** place any AI can be called (tested).
- [ ] No data is sent before consent; `--dry-run` sends nothing (tested).
- [ ] No AI patch is ever applied without an interactive `y`; no `--yes` for AI patches (tested).
- [ ] Every diff passes the Section 7 validation; rejected diffs are never applied (tested).
- [ ] SAME_ERROR and REGRESSION trigger automatic revert with byte-identical restore (tested).
- [ ] Rule-based fixes are always tried before AI (tested).
- [ ] Budgets enforced; stuck-patch detection works.
- [ ] API keys never appear in logs, run files, prompts, or CLI flags (tested).
- [ ] No new npm dependencies; no hardcoded model names.
- [ ] README states the honest claim and limitations from Section 15.
- [ ] Final report delivered.
