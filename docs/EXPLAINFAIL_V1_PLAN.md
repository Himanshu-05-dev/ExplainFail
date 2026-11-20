# EXPLAINFAIL — Production Build Plan (v1)

> **Audience:** an AI coding agent (Antigravity) that will implement this project.
> **Owner:** the human maintainer. This document is the single source of truth.
> **Language of this document:** English (for precision). Everything described here is already decided. Do not redesign it.

---

## 0. RULES FOR THE AI AGENT (READ FIRST, OBEY ALWAYS)

1. **Build only what is written in this document.** Do not add features, commands, flags, detectors, dependencies, config files, telemetry, or "nice extras". If something seems missing, write it in `OPEN_QUESTIONS.md` and continue with the **most conservative** behavior (do less, never more).
2. **No LLM / AI calls anywhere in v1.** No OpenAI/Anthropic/Gemini SDKs, no HTTP calls to AI services. v1 is 100% deterministic and rule-based.
3. **No network calls** except the single approved one described in Detector 5 (`npm view <pkg>`), and only after the user approves the fix.
4. **Never invent error text from memory** when creating test fixtures. Capture real output (see Section 15). If a real capture is impossible, mark the fixture `"synthetic": true` and list it in the final report so the human can replace it.
5. **Never guess a cause.** A diagnosis without evidence must not be produced. This is enforced in code (Section 5.3) and tested.
6. **Never run a fix without explicit user permission** (rules in Section 9).
7. **Never modify user source code files** (`.js .ts .jsx .tsx .py .json(other than allowed) ...`). explainfail v1 may only: run whitelisted commands, create/append `.env`, and read files. See Section 9.
8. **Work in the milestone order of Section 16.** After each milestone: run `npm test`, make sure it passes, then continue. Do not skip ahead.
9. **Do not implement anything in Section 18 (Future Phases).** It is documentation only.
10. When finished, output a **final report**: what was built, what tests pass, which fixtures are synthetic, and everything listed in `OPEN_QUESTIONS.md`.

---

## 1. PRODUCT SUMMARY

**Name:** `explainfail` (npm package + CLI binary).
**Before anything else:** run `npm view explainfail`. If the name is already taken, **STOP and ask the human**. Do not pick another name yourself.

**One-line pitch:** *Evidence-based error doctor for Node projects. It runs your command, explains why it failed using proof from your machine, suggests an exact fix, asks permission, applies it, and verifies by re-running. No guessing.*

**Problems it solves:**
- Developers lose 30–60 minutes on environment/config errors (port busy, wrong Node version, missing `.env` keys, dependency conflicts, missing modules, permission errors, out-of-sync lockfile, git conflict markers).
- AI coding tools often say "fixed" without actually re-running. explainfail's verify step answers **"did it really get fixed?"** using the real exit code and a before/after error fingerprint.

**Principles:**
1. Deterministic rules, no guessing.
2. Evidence first (every diagnosis shows its proof).
3. Honest "I don't know" fallback.
4. Whitelisted fixes only, always with permission.
5. Always verify by re-running the same command.
6. Free, offline, zero setup (`npx explainfail ...`).

---

## 2. SCOPE

### 2.1 IN scope (v1) — build all of this
- CLI with exactly these commands: `explainfail <command...>`, `explainfail doctor`, `explainfail verify "<command>"`, `explainfail report`.
- Command runner with live output pass-through and output capture.
- Error fingerprinting and before/after comparison.
- 8 detectors (Section 8).
- Whitelisted fixers with risk levels and permission prompts.
- Backup + run log in `.explainfail/`.
- Re-run verification and a fix loop (max rounds).
- `report` command including `--for-ai` format.
- Tests with real fixtures.
- README and LICENSE.

### 2.2 OUT of scope (v1) — do NOT build
- Any AI/LLM integration or code-writing/patching.
- MCP server, GitHub Action, plugin loading, telemetry, auto-update, config files, GUI/web UI.
- Support for Python/Docker/other ecosystems.
- PTY emulation.

---

## 3. TECH DECISIONS (FIXED)

| Item | Decision |
|---|---|
| Runtime | Node.js `>=18.17` |
| Language | Plain JavaScript, ES Modules (`"type": "module"`), JSDoc type comments. **No TypeScript, no build step.** |
| CLI parsing | `commander` |
| Process running | `execa` (never build shell strings for fixes) |
| Prompts | `prompts` |
| Colors | `chalk` (respect `NO_COLOR` and non-TTY) |
| Version checks | `semver` |
| Tests | Built-in `node:test` + `node:assert/strict`. Test script: `node --test`. |
| Dependencies | **Exactly:** commander, execa, prompts, chalk, semver. Adding any other dependency requires asking the human. |
| Lint/format | None required. Keep code simple and consistent (2 spaces, semicolons, single quotes). |

---

## 4. REPOSITORY LAYOUT

```
explainfail/
├─ bin/
│  └─ explainfail.js              # #!/usr/bin/env node ; imports src/cli.js
├─ src/
│  ├─ cli.js                  # commander setup, command wiring
│  ├─ context.js              # builds Context (Section 5.1)
│  ├─ runner.js               # run command, tee output, capture, signals
│  ├─ fingerprint.js          # fingerprint + compare (Section 10)
│  ├─ engine.js               # diagnose(): runs detectors, enforces evidence rule
│  ├─ loop.js                 # run → diagnose → fix → verify loop (Section 7)
│  ├─ doctor.js               # `doctor` command logic
│  ├─ verify.js               # `verify` command logic
│  ├─ report.js               # `report` command logic (Section 12)
│  ├─ reporter.js             # terminal output formatting (Section 11)
│  ├─ backup.js               # backups + run logs in .explainfail/ (Section 13)
│  ├─ redact.js               # secret redaction (Section 14)
│  ├─ detectors/
│  │  ├─ index.js             # exports ordered array of detectors
│  │  ├─ port-in-use.js
│  │  ├─ node-version.js
│  │  ├─ env-missing.js
│  │  ├─ eresolve.js
│  │  ├─ module-not-found.js
│  │  ├─ eacces.js
│  │  ├─ lockfile-sync.js
│  │  └─ merge-conflict.js
│  └─ util/
│     ├─ pm.js                # detect package manager from lockfile
│     ├─ fs.js                # safe read helpers
│     └─ platform.js          # OS helpers
├─ test/
│  ├─ fixtures/<detector-id>/<case-name>/
│  │     ├─ output.txt        # real captured output
│  │     ├─ project/          # minimal project files for the case
│  │     └─ expected.json     # what must be detected, `synthetic` flag
│  ├─ detectors/*.test.js
│  ├─ fingerprint.test.js
│  ├─ redact.test.js
│  ├─ runner.test.js
│  ├─ backup.test.js
│  ├─ engine.test.js
│  └─ e2e/*.test.js
├─ scripts/
│  └─ capture-fixtures.js     # reproduces real errors to generate fixtures (Section 15)
├─ package.json
├─ README.md
├─ LICENSE                    # MIT
├─ OPEN_QUESTIONS.md          # created by the agent if needed
└─ .gitignore                 # node_modules, .explainfail/
```

---

## 5. CORE DATA TYPES (implement exactly with these fields)

### 5.1 Context
```js
/**
 * @typedef {Object} Context
 * @property {string}   cwd
 * @property {{argv: string[]|null, shell: string|null}} command  // exactly one of argv/shell is non-null
 * @property {string}   output        // captured stdout+stderr, ANSI stripped, last 200 KB max
 * @property {number|null} exitCode
 * @property {string|null} signal
 * @property {NodeJS.Platform} platform
 * @property {'npm'|'yarn'|'pnpm'|'bun'|null} pm   // from lockfile (Section util/pm.js)
 * @property {object|null} pkg        // parsed package.json or null
 * @property {boolean}  interactive   // process.stdin.isTTY && process.stdout.isTTY
 */
```

### 5.2 Detector interface
```js
/**
 * @typedef {Object} Detector
 * @property {string} id
 * @property {string} title
 * @property {(ctx: Context) => (Match|null)} match               // PURE. Regex on ctx.output only. No I/O.
 * @property {(ctx: Context, m: Match) => Promise<Evidence[]|null>} gather  // I/O allowed (read-only). Return null/[] if cause cannot be confirmed.
 * @property {(m: Match, ev: Evidence[]) => string} explain       // plain-language, uses only evidence values
 * @property {(ctx: Context, m: Match, ev: Evidence[]) => Fix[]} fixes
 * @property {(ctx: Context) => Promise<Finding[]>} [preflight]   // optional; used by `doctor` and as extra facts after a failure
 */
// Match    = { detectorId: string, data: Record<string,string>, matchedLines: string[] }
// Evidence = { label: string, value: string }
// Finding  = { detectorId: string, title: string, evidence: Evidence[], fixes: Fix[] }
```

### 5.3 Diagnosis and the evidence rule
```js
// Diagnosis = {
//   detectorId, title,
//   kind: 'cause' | 'finding',   // 'cause': output pattern matched AND evidence confirmed.
//                                // 'finding': a verified fact about the project, NOT claimed to be the cause.
//   evidence: Evidence[],        // MUST be non-empty
//   explanation: string,
//   fixes: Fix[]
// }
```
**Engine rule (enforced in `engine.js` + unit test):** a Diagnosis with empty `evidence` is dropped. If dev mode (`NODE_ENV=test`), throw instead.

### 5.4 Fix
```js
/**
 * @typedef {Object} Fix
 * @property {string} id
 * @property {string} label               // one-line description shown to user
 * @property {'command'|'file'|'manual'} type
 * @property {'low'|'medium'|'high'} risk
 * @property {string[]} [argv]            // for 'command': executed WITHOUT a shell
 * @property {string}   [cwd]
 * @property {{path:string, action:'create'|'modify'}[]} [files]  // for 'file': what will change (shown in dry-run)
 * @property {(ctx: Context) => Promise<void>} [apply]            // for 'file'
 * @property {string}   [manualText]      // for 'manual': exact instructions shown, never executed
 * @property {string}   [warning]
 */
```
**Risk meaning:**
- `low`: reversible, touches only generated/untracked things (e.g. create `.env` from `.env.example` when `.env` does not exist, `npm install` when `node_modules` is missing).
- `medium`: changes tracked files (lockfile), kills a process, or can hide problems (`--legacy-peer-deps`).
- `high`: reserved. **No v1 fix may be `high`.** Anything that would be `high` must be `manual` type only.

---

## 6. CLI SPECIFICATION

Binary name: `explainfail`. `package.json` → `"bin": { "explainfail": "./bin/explainfail.js" }`.

### 6.1 `explainfail <command...>`  (run mode)
```bash
explainfail npm run dev
explainfail node server.js
explainfail "npm run build && npm test"     # single quoted arg containing whitespace = shell string
```
Options:
- `--no-fix` : diagnose only, never prompt.
- `--yes` : auto-approve fixes with risk `low` only. `medium` still asks (or is skipped when non-interactive).
- `--dry-run` : show what each fix would do; apply nothing, run nothing.
- `--max-rounds <n>` : default `5`.
- `--verify-timeout <sec>` : default `60`. `0` = wait forever. (Section 7, step 9.)
- `--also "<command>"` : repeatable. Extra commands run after the main command passes during verification (regression check).

Parsing rule: use commander with `.allowUnknownOption()` and `.passThroughOptions()` so that flags after the command (e.g. `npm run dev --port 3000`) belong to the user's command, not explainfail. explainfail's own flags must come **before** the command.

Exit code: the exit code of the **final** run of the user's command. Internal explainfail error → exit `70`.

### 6.2 `explainfail doctor`
Runs every detector's `preflight` (no user command). Prints a checklist (✔ ok / ✖ problem / – skipped). Exit `0` if no problems, `1` if any. Option `--fix`: offer fixes through the same permission flow (Section 9).

### 6.3 `explainfail verify "<command>"`
Runs the command once and reports facts. Never applies fixes. Options: `--json`, `--also "<cmd>"` (repeatable), `--baseline <file>` (fingerprint JSON; default `.explainfail/last-failure.json` if it exists and the command matches), `--timeout <sec>` (default 60, 0 = forever).
Result statuses:
- `PASS` — exit code 0.
- `STAYED_UP` — process still running at timeout, no known error seen (explainfail stops it; this is **not** proof of clean exit — say so in output).
- `SAME_ERROR` — fails with the same fingerprint as baseline.
- `NEW_ERROR` — fails with a different fingerprint than baseline (or no baseline: any failure).
Exit codes: `0` for `PASS`/`STAYED_UP` (and all `--also` pass), `1` otherwise, `70` internal error. `--json` prints one JSON object: `{status, command, exitCode, fingerprint, baselineFingerprint|null, detectorsMatched[], also:[{command,exitCode}]}`.

### 6.4 `explainfail report`
Reads the latest run log (`.explainfail/runs/latest.json`). Options: `--for-ai` (Section 12), `--json`. If no log exists: print "No explainfail run found in this project." exit 1.

Global: `--version`, `--help`. Nothing else.

---

## 7. ENGINE FLOW (RUN MODE) — implement in `loop.js`

```
round = 1
LOOP:
 1. RUN the command (runner.js). Output streams live to the terminal AND is captured.
 2. If exit code 0 → print success summary (if any fix was applied: show chain). EXIT 0.
 3. If the process ended because the USER interrupted it (SIGINT/SIGTERM that explainfail forwarded)
    AND no live match occurred (see below) → exit with the child's code, no diagnosis.
 4. Build fingerprint F_before (Section 10). Save `.explainfail/last-failure.json`.
 5. DIAGNOSE (engine.js): for each detector: match → gather → explain → fixes. Also run `preflight`
    of detectors as extra `finding`s (only those that report an actual problem).
 6. Print diagnoses (Section 11). If none: print the UNKNOWN fallback and EXIT with child's code.
 7. If --no-fix or --dry-run or non-interactive without --yes → EXIT with child's code.
 8. PERMISSION: for the top-ranked fix of the first `cause` diagnosis (else first `finding`):
    ask `Apply this fix? (y/N)` (default No). --yes auto-approves ONLY risk 'low'.
    'manual' fixes are never applied; they are displayed. If user declines → EXIT.
 9. BACKUP (Section 13) then APPLY the fix. If apply throws → restore backup, print error, EXIT.
10. RE-RUN THE SAME COMMAND (identical argv/shell string, same cwd). If it is still running after
    --verify-timeout seconds with no known error → status STAYED_UP, explainfail terminates it.
11. COMPARE F_after to F_before:
      exit 0                 → PASS      → run each --also command; any failure → report it as a regression.
      STAYED_UP              → report STAYED_UP (not claimed as fixed; say "no known error seen in N s").
      same fingerprint       → SAME_ERROR → print "Fix did not solve it"; offer revert (Section 13) → EXIT.
      different fingerprint  → NEW_ERROR  → round += 1; if round > max-rounds → EXIT; else go to step 4
                                            using the NEW error (this is the error-chain behavior).
12. Write run log `.explainfail/runs/<timestamp>.json` and update `latest.json` at every EXIT path.
```
**Live detection (long-running processes such as dev servers):** while the child runs, test each detector's `match(ctx)` against newly arrived output (debounce 500 ms). On the first hit per detector print **one line only**: `explainfail: output matches known problem "<detector-id>" — full diagnosis when the process exits.` Remember that a live match occurred; if the user then presses Ctrl+C, step 3 does NOT skip diagnosis. Never kill or alter the running process because of a live match.

---

## 8. DETECTORS (exactly these 8, in this priority order)

Order in `detectors/index.js`: `port-in-use`, `node-version`, `module-not-found`, `eresolve`, `lockfile-sync`, `eacces`, `env-missing`, `merge-conflict`.

For each: **Trigger** (pattern on output) → **Evidence** (read-only checks) → **Fixes**. If evidence cannot be gathered, return no diagnosis.

### 8.1 `port-in-use`
- **Trigger:** `/EADDRINUSE/` or `/address already in use/i`. Extract port from `:::(\d+)`, `:(\d+)\s*$` on the matched line, or `address already in use \S*:(\d+)`.
- **Evidence:**
  - macOS/Linux: `lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpcn` (parse PID, command name). If `lsof` is missing, try `ss -ltnp` on Linux.
  - Windows: `netstat -ano -p TCP`, filter `LISTENING` on that port, then `tasklist /FI "PID eq <pid>" /FO CSV /NH`.
  - Evidence items: `Port`, `PID`, `Process name`, `Command` (if available).
  - If no listener is found → **no diagnosis** (the port may have been freed already).
- **Fixes:**
  1. `command`, risk `medium`: terminate that PID (`process.kill(pid, 'SIGTERM')` on POSIX; `taskkill /PID <pid>` on Windows). Before killing, re-check the PID still listens on that port. **Never** kill explainfail's own PID or its parent PID. Warning text: "This stops the process shown in the evidence."
  2. `manual`: show "Use a different port" with a generic example (`PORT=<other> <your command>`), clearly labeled as a suggestion because explainfail cannot know how the app reads its port.

### 8.2 `node-version`
- **Trigger:** `/Unsupported engine/`, `/The engine "node" is incompatible/`, `/requires Node(\.js)? .*(>=|\^|~|\d)/i`, `/ERR_REQUIRE_ESM/` is **not** included.
- **Evidence:** current Node (`process.version`), `.nvmrc`, `.node-version`, `package.json → engines.node`. Use `semver.satisfies`/`semver.coerce`. Diagnose only if at least one spec exists AND the current version does not satisfy it.
- **Preflight (doctor):** same check without needing an error.
- **Fixes:** `manual` only (`nvm`, `fnm`, `volta` are shell functions/tools explainfail cannot reliably apply). `manualText`: show `nvm use <spec>` / `fnm use` / `volta pin node@<spec>` as options, plus the download link `https://nodejs.org`. State clearly: "explainfail cannot change your shell's Node version."

### 8.3 `module-not-found`
- **Trigger:** `/Cannot find module '([^']+)'/` or `/Cannot find package '([^']+)' imported from/` or `ERR_MODULE_NOT_FOUND`.
- **Evidence & branching:**
  - Name starts with `.` or `/` → it is a file path problem. Evidence: resolved path and `exists: false`. Fix: `manual` ("this is a relative path; check file name/case/extension"). No command fix.
  - Bare package name:
    - Listed in `package.json` (dependencies/devDependencies/optionalDependencies) but `node_modules/<name>/package.json` missing → Fix `command`, risk `low`: install command for detected `pm` (`npm install`, `yarn install`, `pnpm install`, `bun install`).
    - Not listed in `package.json` → Fix `command`, risk `medium`: `<pm> add <name>` (for npm: `npm install <name>`). Before offering, run read-only `npm view <name> name` (**the one approved network call**). If it fails/unreachable → show `manual` text saying existence on the registry could not be verified. If the name is a Node builtin (`require('module').builtinModules`) → no diagnosis. Warning: "It may belong in devDependencies."
- **Preflight (doctor):** list dependencies from `package.json` whose `node_modules/<name>/package.json` is missing.

### 8.4 `eresolve`
- **Trigger:** `/npm (ERR!|error) code ERESOLVE/`.
- **Evidence:** verbatim lines from output: those containing `Found:`, `Could not resolve dependency`, `peer `, `Conflicting peer dependency`. Parse package names/versions if possible; if parsing fails, still present the raw lines. Never paraphrase versions.
- **Fixes:**
  1. `manual`: "Align the conflicting versions" naming the packages from the evidence.
  2. `command`, risk `medium`: re-run the **same npm install command** that failed with `--legacy-peer-deps` appended. Only offered when the failed command is `npm install|i|ci|update` (argv[0]=npm). Warning: "This can hide real incompatibilities."

### 8.5 `lockfile-sync`
- **Trigger (any):**
  - npm: `/`npm ci` can only install packages when your package.json and package-lock.json .* are in sync/s`, `/Missing: .* from lock file/`, `/Invalid: lock file/`.
  - yarn: `/Your lockfile needs to be updated/`.
  - pnpm: `/ERR_PNPM_OUTDATED_LOCKFILE/`.
- **Evidence:** verbatim matched lines; lockfile file name and that it exists.
- **Preflight (doctor), npm only:** parse `package-lock.json` (`packages[""]`) and compare `dependencies`, `devDependencies`, `optionalDependencies` (names and range strings) with `package.json`. Report differences as evidence. yarn/pnpm: print "skipped (unsupported in v1)".
- **Fixes (backup the lockfile first):** `command`, risk `medium`: npm → `npm install`; yarn → `yarn install`; pnpm → `pnpm install --no-frozen-lockfile`. Warning: "This changes your lockfile."

### 8.6 `eacces`
- **Trigger:** `/(EACCES|EPERM)/` with a quoted path (`'([^']+)'`) on the same or following line.
- **Evidence (POSIX only):** `fs.stat` of the path (or its nearest existing parent): owner uid, mode (octal), current uid. Diagnose only when the path exists (or a parent) and the current user lacks the needed access (`fs.access`). On Windows: report raw lines only as a `finding`-less "unsupported on Windows (v1)" message, no fix.
- **Fixes:** `manual` only. If the owner is root and current user is not: show `sudo chown -R "$(id -u):$(id -g)" "<path>"` as **text**. If the path is inside the npm global prefix (`npm config get prefix`), also show the link `https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally`. explainfail **never** runs `sudo`, never runs `chmod 777`.

### 8.7 `env-missing`
- **Trigger:** none on output. This detector is **`finding`-only**: it runs as `preflight` (doctor) and, after any failed run, as an extra fact.
- **Evidence:** if `.env.example` (or `.env.sample`) exists: compare KEY names with `.env`. Evidence = list of **missing key names** (or "`.env` file missing"). **Never read or print values from `.env`.**
- **Fixes:**
  1. `.env` missing → `file`, risk `low`: create `.env` as a copy of `.env.example`.
  2. keys missing → `file`, risk `medium`: append missing keys as `KEY=` (empty values) with a header comment `# added by explainfail`. Backup `.env` first.
- After a failed run this is shown as a **`finding`** ("not claimed as the cause"), never as `cause`.

### 8.8 `merge-conflict`
- **Trigger:** none required (`finding`-only like 8.7), additionally promoted to `cause` if the failed output mentions a file path that contains conflict markers.
- **Evidence:** scan project text files (prefer `git ls-files`; if not a git repo, walk excluding `node_modules`, `.git`, `dist`, `build`, `.explainfail`). Skip files > 1 MB and binary files. A file counts only if it has **all three** markers: a line starting `<<<<<<< `, a line exactly `=======`, a line starting `>>>>>>> `. Evidence: `path:line` of each marker start (cap 20 files).
- **Fixes:** `manual` only: "Resolve the conflicts in these files, then run `git add`." No auto-fix.

---

## 9. FIXERS & PERMISSION RULES

1. **Whitelist:** only fixes constructed inside the detector files above may run. There is no generic "run this command" path. No user-supplied or generated shell strings.
2. **Command fixes** run via `execa(argv[0], argv.slice(1), { cwd, shell: false, stdio: 'inherit' })`.
3. **Prompt format** (before any apply):
   ```
   Fix: <label>
   Risk: <low|medium>
   Will run: <argv joined for display>     (or "Will change: <files>")
   Warning: <warning if any>
   Apply this fix? (y/N)
   ```
4. `--dry-run`: print the same block, then `(dry-run) nothing was changed`, apply nothing.
5. Non-interactive (no TTY): never prompt. Behaves as `--no-fix` unless `--yes` (low only).
6. explainfail **never**: edits source code, runs `sudo`, runs `rm -rf`, edits `.gitignore`, edits `package.json`, runs more than one fix per round.
7. Protected-file rule (for future AI phase, but enforce a helper now in `fs.js`): a constant `PROTECTED_GLOBS` (`**/*.test.*`, `**/*.spec.*`, `.github/**`, lockfiles except via package-manager commands). No v1 fix writes these directly.

---

## 10. FINGERPRINT & COMPARISON (`fingerprint.js`)

```js
// Fingerprint = { exitCode, errorCode: string|null, errorLine: string|null, tailHash: string, detectorIds: string[] }
```
**Normalize text** (function `normalize(text, ctx)`):
1. Strip ANSI escape codes.
2. Replace absolute project root with `<root>`; home dir with `~`.
3. Timestamps (`\d{4}-\d{2}-\d{2}T[\d:.]+Z?`) → `<ts>`.
4. Durations (`\d+(\.\d+)?\s?(ms|s)\b`) → `<dur>`.
5. Hex strings of 8+ chars → `<hex>`.
6. `pid[ =:]*\d+` → `pid <n>`.
7. Collapse whitespace. **Keep port numbers.**

**errorCode:** first match of `\b(E[A-Z]{3,9}|ERR_[A-Z0-9_]+)\b` in output, **ignoring** `ERROR`, `ELIFECYCLE`, `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` (wrapper noise). Known specific codes (`EADDRINUSE`, `EACCES`, `EPERM`, `ERESOLVE`, `ERR_MODULE_NOT_FOUND`, `MODULE_NOT_FOUND`) take precedence.
**errorLine:** first line matching `/(Error:|error:|ERR!|ERESOLVE|EADDRINUSE|Cannot find|SyntaxError|TypeError|ReferenceError)/`; if none, the last non-empty line. Normalized.
**tailHash:** SHA-1 of the normalized last 20 non-empty lines.

**compare(before, after):**
- `after.exitCode === 0` → `PASS`.
- `errorCode` equal AND `errorLine` equal → `SAME_ERROR`.
- both `errorCode` null AND `tailHash` equal → `SAME_ERROR`.
- otherwise → `NEW_ERROR`.

---

## 11. TERMINAL OUTPUT FORMAT (`reporter.js`)

Use this structure (colors optional, symbols as shown; plain text when `NO_COLOR` or not TTY):

```
✖ Command failed: npm run dev   (exit code 1)

PROBLEM  Port already in use                         [cause]
EVIDENCE
  Port          3000
  PID           4821
  Process       node
  Command       node server.js
EXPLANATION
  Port 3000 is already being used by process 4821 (node server.js).
FIX  (risk: medium)
  Stop process 4821.
  Will run: kill -TERM 4821
? Apply this fix? (y/N)
```
After re-run, one of:
```
✔ PASS: command now exits with code 0.
⚠ STAYED UP: still running after 60s, no known error seen. This is not proof of a clean exit.
✖ SAME ERROR: the fix did not solve it. (errorCode EADDRINUSE unchanged)
⚠ NEW ERROR: previous problem is gone, but a different error appeared: <errorLine>
```
**UNKNOWN fallback (exactly this wording):**
```
explainfail could not confirm a cause for this failure. No rule matched with evidence.
Last error line: <errorLine>
Search: https://www.google.com/search?q=<url-encoded errorLine>
```
No guessing text, ever. The Google URL is only printed, never fetched.

---

## 12. `explainfail report --for-ai`

Purpose: give any AI IDE a **clean, verified** context so it does not guess. Output Markdown with exactly these sections:

```
# explainfail report
## Command
<command> (cwd: <relative or .>) — exit code <n>
## Verified facts (checked by explainfail on this machine)
- <Evidence label>: <value>      (only facts from diagnoses; mark each [cause] or [finding])
## Environment
- OS / platform, Node version, package manager, lockfile present, node_modules present
## Error (last 80 lines of output, redacted)
<fenced block>
## Already tried (do not repeat)
1. <fix label> → result: PASS | SAME_ERROR | NEW_ERROR (<errorLine>)
## Not verified
- explainfail could not confirm a cause.   (only if there were no diagnoses)
```
Rules: apply `redact()` to everything; never include `.env` values; never add advice or guesses that are not in the log. `--json` returns the same data as JSON.

---

## 13. BACKUPS & RUN LOGS (`backup.js`)

- Directory `.explainfail/` in the project root (created on demand). Add to this repo's `.gitignore`; in user projects only **print a one-time tip** suggesting they ignore it (never edit their `.gitignore`).
- Before any `file` fix or lockfile-changing command fix: copy affected files to `.explainfail/backups/<ISO-timestamp>/<original relative path>`.
- `restore(timestamp)` copies them back. On `SAME_ERROR` after a fix, ask `Revert the changes of this fix? (y/N)` and restore if yes.
- Run log `.explainfail/runs/<ISO-timestamp>.json` + `latest.json`: `{command, startedAt, rounds:[{round, fingerprintBefore, diagnoses:[{id,kind,evidence}], fixApplied:{id,label,risk}|null, result: status, fingerprintAfter}], finalStatus}`. Apply `redact()` to saved output excerpts.
- Keep only the 20 most recent runs/backups (delete older).

---

## 14. SECURITY & PRIVACY (hard requirements)

- No telemetry, no analytics, no phone-home.
- Never read, print, log, or store values from `.env*` files. Key names only.
- `redact(text)` (in `redact.js`) must mask: `Bearer <token>`, `sk-…`, `ghp_…`, `AKIA…`, `xox[baprs]-…`, `-----BEGIN … PRIVATE KEY-----` blocks, `password=…`/`token=…`/`secret=…`/`apikey=…` (case-insensitive, `key=value` and `key: value` forms), and any `https?://user:pass@` credentials. Replace with `<redacted>`. Used for run logs and `report`.
- Child commands inherit the user's environment unchanged. explainfail adds nothing except `FORCE_COLOR=1` when its own stdout is a TTY.
- Commands from the user: single argument containing whitespace → run as shell string (it is the user's own command); multiple args → `argv` without shell.

---

## 15. TESTING REQUIREMENTS

Run with `npm test` (`node --test`). All tests must pass offline.

**Fixtures:** each case folder = `output.txt` (real captured output), `project/` (minimal files), `expected.json` (`{ "detectorId", "kind", "evidence": {...}, "synthetic": false }`).
- `scripts/capture-fixtures.js` reproduces errors **for real** where possible: start a listener on a port then run a server on the same port (EADDRINUSE); project with `.nvmrc` set to a different major (node-version); `require('nonexistent-pkg-xyz')` (module-not-found); `.env.example` with extra keys; a file with real conflict markers; unreadable dir for EACCES on POSIX; `npm ci` with a deliberately out-of-sync lockfile. ERESOLVE: create a tiny project with two packages having conflicting peer ranges and capture the real npm output; if impossible offline, mark `synthetic: true`.
- Do not hand-write error messages from memory. See Rule 4.

**Required tests:**
1. Each detector: positive fixture matches and gathers correct evidence; negative fixture (unrelated error) → `match` returns null; evidence missing → no diagnosis.
2. `engine.test.js`: diagnosis with empty evidence is dropped/throws.
3. `fingerprint.test.js`: normalization cases; compare → PASS / SAME_ERROR / NEW_ERROR; ignores `ELIFECYCLE`.
4. `redact.test.js`: each pattern in Section 14 is masked; non-secrets untouched.
5. `runner.test.js`: exit code propagation, output captured and streamed, SIGINT handling, 200 KB cap, shell-string vs argv.
6. `backup.test.js`: backup → modify → restore returns identical bytes; retention of 20.
7. `e2e/`:
   - Real port conflict: explainfail reports the correct PID; with `--yes`… (medium risk) must **not** auto-apply; with a simulated "y" input it kills the blocker and re-run yields PASS.
   - `.nvmrc` mismatch → manual fix shown, nothing executed.
   - Non-interactive run never prompts.
   - `--dry-run` changes nothing (verify by hashing the project tree before/after).
   - `verify` returns correct status and exit codes; `--json` schema is stable.
   - Unknown error → exact UNKNOWN wording.
8. Platform: tests that need `lsof`/POSIX are skipped on Windows with a clear skip reason.

---

## 16. MILESTONES (BUILD IN THIS ORDER; STOP AND TEST AFTER EACH)

**M0 — Setup.** `npm view explainfail` check (Section 1). `package.json` (name, version `0.1.0`, `type: module`, `bin`, `engines`, `files: ["bin","src"]`, `license: MIT`, scripts `test`), install the 5 dependencies, `.gitignore`, `LICENSE`, skeleton folders.
*Accept:* `node bin/explainfail.js --version` prints `0.1.0`.

**M1 — Runner.** `runner.js`: execa spawn, live tee to terminal, capture (ANSI-stripped copy, 200 KB cap), signal forwarding, `FORCE_COLOR`, shell-string vs argv.
*Accept:* `explainfail node -e "process.exit(3)"` exits 3 and shows its output; Ctrl+C forwarded.

**M2 — Fingerprint + redact + context.** `fingerprint.js`, `redact.js`, `context.js`, `util/pm.js`.
*Accept:* tests in Section 15 items 3 and 4 pass.

**M3 — Engine + reporter (no detectors yet).** `engine.js` with the evidence rule, `reporter.js` formats, UNKNOWN fallback.
*Accept:* running a failing command prints the exact UNKNOWN wording; engine test passes.

**M4 — Detectors 1–3:** `port-in-use`, `node-version`, `module-not-found` with fixtures, tests, fixes.
*Accept:* detector tests pass; manual run on a real busy port shows correct PID.

**M5 — Backup + loop.** `backup.js`, `loop.js` (steps 1–12 of Section 7), permission prompts, `--yes`, `--dry-run`, `--no-fix`, `--max-rounds`, `--verify-timeout`, live-match hint.
*Accept:* e2e port-conflict flow (fail → diagnose → approve → re-run → PASS) works.

**M6 — Detectors 4–8:** `eresolve`, `lockfile-sync`, `eacces`, `env-missing`, `merge-conflict`.
*Accept:* all detector tests pass.

**M7 — `doctor`, `verify`, `report`** (+ `--for-ai`, `--json`, `--also`).
*Accept:* e2e tests for these commands pass; exit codes exactly as Section 6.

**M8 — Docs + polish.** README (Section 17), error handling (internal error → exit 70 with a short message), final `npm test` green, `npm pack --dry-run` shows only `bin`, `src`, `README.md`, `LICENSE`, `package.json`.
*Accept:* final report (Rule 10) produced.

---

## 17. README REQUIREMENTS

Must include, in this order:
1. Pitch (Section 1) + a placeholder `<!-- TODO: add 10-second demo GIF -->`.
2. Usage: `npx explainfail npm run dev`, global install, and `package.json` script wiring (`"dev": "explainfail vite"`, `"dev:raw": "vite"`).
3. Commands table (Section 6).
4. The 8 detectors table (problem / evidence / fix).
5. "How explainfail avoids guessing" (Section 1 principles).
6. **Honest limitations** (copy these):
   - explainfail does **not** find logic bugs. Exit code 0 means "the command ran without a known error", not "your code is correct".
   - It can only explain the 8 known problem types in v1. Anything else gets the "could not confirm" message.
   - Node version changes (`nvm`/`fnm`/`volta`) must be done by you; explainfail only tells you what to run.
   - No PTY: some tools print less color/progress when run through explainfail.
   - Windows support is partial in v1 (port detection works; permission diagnosis does not).
   - `STAYED_UP` is not proof of a clean exit.
7. Privacy statement (Section 14).
8. Contributing: "one detector = one file" and the Detector interface.

---

## 18. FUTURE PHASES — **DOCUMENTATION ONLY. DO NOT IMPLEMENT.**

**Phase 2 (after v1 ships):**
- **MCP server** (local stdio process, not an internet server) exposing tools `explainfail_diagnose` and `explainfail_verify`, so AI IDEs can call explainfail as a truth-checker instead of guessing.
- **GitHub Action** that runs `explainfail verify` on failure and comments the evidence on the PR.
- **Plugin loading** for community detectors (`explainfail-plugin-*`) using the Detector interface of Section 5.2.

**Phase 3 (optional, opt-in only):**
- AI adapter loop: explainfail stays the controller and judge; the AI only **proposes a unified diff**. explainfail validates (paths exist, old lines match, no protected files, size limit, no suppression hacks like `eslint-disable`/`@ts-ignore`/deleted tests), shows the diff, asks permission, applies on a git branch/stash, re-runs the same command, and **auto-reverts** on failure or regression. Context given to AI = stack-trace files + their imports + `report --for-ai` output, never the whole repo. Budget: max rounds + token limit. Honest claim: *"hallucinations are caught and reverted"*, not *"no hallucinations"*.

---

## 19. DEFINITION OF DONE (v1)

- [ ] `npm test` passes offline, on macOS/Linux (Windows: documented partial).
- [ ] All 4 commands work with the exact flags and exit codes in Section 6.
- [ ] All 8 detectors implemented per Section 8 with real fixtures (synthetic ones listed).
- [ ] No diagnosis is ever produced without evidence (tested).
- [ ] No fix ever runs without permission; `--dry-run` changes nothing (tested).
- [ ] Secrets are redacted in logs and reports (tested); `.env` values are never read or printed.
- [ ] Only the 5 approved dependencies are used.
- [ ] No AI/LLM code, no telemetry, no extra commands/features.
- [ ] README includes the honest limitations section.
- [ ] `npm pack --dry-run` lists only intended files.
- [ ] Final report delivered (what was built, test results, synthetic fixtures, `OPEN_QUESTIONS.md`).
