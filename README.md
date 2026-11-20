# explainfail

> **Evidence-based error doctor for Node projects.**
> It runs your command, explains why it failed using proof from your machine, suggests an exact fix, asks permission, applies it, and verifies by re-running. No guessing.

<!-- TODO: add 10-second demo GIF -->

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Setup](https://img.shields.io/badge/setup-zero%20config-orange.svg)]()
[![Offline & Private](https://img.shields.io/badge/privacy-100%25%20offline%20%7C%20no%20telemetry-success.svg)]()

---

## Quick Start & Usage

Run on-demand without installing using `npx`:

```bash
# Wrap any command that is failing
npx explainfail npm run dev
npx explainfail node server.js

# Multi-command shell pipelines (use quotes)
npx explainfail "npm run build && npm test"
```

### Global Install

```bash
npm install -g explainfail
explainfail npm run dev
```

### Wire into `package.json`

Keep your default dev workflow resilient by wrapping your dev script, while preserving an unwrapped raw fallback:

```json
{
  "scripts": {
    "dev": "explainfail vite",
    "dev:raw": "vite",
    "build": "explainfail npm run build:raw",
    "build:raw": "tsc && vite build"
  }
}
```

---

## Commands & CLI Reference

| Command | Description | Key Options |
|---|---|---|
| `explainfail <command...>` | Runs command, streams output live, captures errors, diagnoses root cause using system evidence, prompts before fixing, and verifies with a re-run. | `--no-fix`, `--yes`, `--dry-run`, `--max-rounds <n>`, `--verify-timeout <sec>`, `--also <cmd>` |
| `explainfail doctor` | Runs preflight checks across all detectors without executing a command. Prints a problem checklist. | `--fix` (prompts for safe fixes) |
| `explainfail verify "<command>"` | Runs the command once and reports verified facts (`PASS`, `STAYED_UP`, `SAME_ERROR`, `NEW_ERROR`) against baseline fingerprint. Never applies fixes. | `--baseline <file>`, `--timeout <sec>`, `--also <cmd>`, `--json` |
| `explainfail report` | Inspects latest failure run log from `.explainfail/runs/latest.json`. Produces structured summaries. | `--for-ai` (Markdown for AI IDEs), `--json` |

### Command Flags

- `--no-fix`: Diagnose only; never prompt to apply fixes.
- `--yes`: Automatically approve low-risk fixes (medium-risk fixes still require confirmation).
- `--dry-run`: Display exact commands or file changes without executing or altering anything.
- `--max-rounds <n>`: Maximum fix-and-verify iterations (default: `5`).
- `--verify-timeout <sec>`: Time to wait during re-run before declaring `STAYED_UP` for background/server processes (default: `60s`, `0` = wait forever).
- `--also "<command>"`: Extra command to run after primary command passes verification (regression check; repeatable).
- `--for-ai`: Export clean, evidence-based markdown report designed specifically for AI coding assistants.
- `--json`: Output structured machine-readable JSON.

---

## Architecture

`explainfail` is designed as a deterministic, modular pipeline. It strictly separates pure output pattern matching from I/O evidence gathering, whitelisted fix generation, and verification loops.

```mermaid
flowchart TD
    subgraph CLI ["CLI & Entrypoint"]
        BIN["bin/explainfail.js"] --> CLI_JS["src/cli.js (Commander)"]
    end

    subgraph CORE ["Runner & Context"]
        CLI_JS --> RUNNER["src/runner.js (Execa)"]
        CLI_JS --> CTX["src/context.js"]
    end

    subgraph ENGINE ["Diagnosis Engine"]
        CLI_JS --> LOOP["src/loop.js (Run/Fix/Verify Loop)"]
        LOOP --> ENG["src/engine.js"]
        ENG --> DET_IDX["src/detectors/index.js"]
        
        subgraph DETECTORS ["8 Core Detectors"]
            D1["port-in-use"]
            D2["node-version"]
            D3["module-not-found"]
            D4["eresolve"]
            D5["lockfile-sync"]
            D6["eacces"]
            D7["env-missing"]
            D8["merge-conflict"]
        end
        DET_IDX --> D1 & D2 & D3 & D4 & D5 & D6 & D7 & D8
    end

    subgraph SAFETY ["Safety, State & Verification"]
        LOOP --> FP["src/fingerprint.js"]
        LOOP --> BACKUP["src/backup.js (.explainfail/backups)"]
        LOOP --> REDACT["src/redact.js"]
    end

    subgraph OUTPUT ["Output & Reporting"]
        LOOP --> REPORTER["src/reporter.js"]
        CLI_JS --> DOCTOR["src/doctor.js"]
        CLI_JS --> VERIFY["src/verify.js"]
        CLI_JS --> REPORT["src/report.js"]
    end
```

### Module Responsibilities

- **`src/runner.js`**: Spawns processes using `execa`, streaming live output to stdout/stderr while buffering an ANSI-stripped 200 KB sliding window. Forwards POSIX signals (`SIGINT`, `SIGTERM`).
- **`src/context.js`**: Builds runtime context (command argv/shell, working directory, package manager, detected lockfiles, platform).
- **`src/fingerprint.js`**: Normalizes error output (replaces variable PIDs, timestamps, hex hashes, paths) and generates SHA-1 tail hashes for objective before/after comparison.
- **`src/engine.js`**: Executes detectors. Enforces the **strict evidence rule**: diagnoses without confirmed host evidence are dropped.
- **`src/detectors/*`**: Individual rule modules. Each detector implements pure regex matching (`match`), read-only evidence gathering (`gather`), explanation formatting (`explain`), and whitelisted fixes (`fixes`).
- **`src/backup.js`**: Takes atomic snapshots of affected files before applying fixes, enabling automated or interactive rollbacks.
- **`src/redact.js`**: Sanitizes sensitive credentials, tokens, bearer headers, and keys before writing to disk or exporting reports.

---

## Execution & Verification Flow

The execution loop guarantees that errors are fixed based on real system proof, and that fixes are validated by actually re-running the command.

```mermaid
flowchart TD
    START(["Start: explainfail &lt;command...&gt;"]) --> RUN["1. Run Command (tee stdout/stderr)"]
    RUN --> CHECK_EXIT{"Exit Code 0?"}

    CHECK_EXIT -- "Yes (Code 0)" --> SUCCESS["Print Success Summary<br/>Exit 0"]
    CHECK_EXIT -- "No (Failed)" --> CHECK_INT{"Interrupted by User<br/>(SIGINT/SIGTERM)?"}

    CHECK_INT -- "Yes (and no live match)" --> EXIT_CHILD["Forward Exit Code<br/>(No diagnosis)"]
    CHECK_INT -- "No / Live Match Hit" --> FINGERPRINT["2. Compute Fingerprint F_before<br/>Save .explainfail/last-failure.json"]

    FINGERPRINT --> MATCH["3. Pattern Match (Regex on Output)"]
    MATCH --> GATHER["4. Gather Machine Evidence<br/>(Read-only OS &amp; FS inspect)"]
    GATHER --> VALIDATE{"Evidence Confirmed?<br/>(Engine Rule)"}

    VALIDATE -- "No Evidence" --> UNKNOWN["5. Honest UNKNOWN Fallback<br/>(Print search link, no guessing)"]
    UNKNOWN --> EXIT_FAIL["Exit with Child Code"]

    VALIDATE -- "Evidence Found" --> DIAG["5. Present Diagnoses &amp; Proof<br/>(Problem, Evidence, Fix)"]
    DIAG --> CHECK_OPTS{"--no-fix OR --dry-run<br/>OR Non-Interactive?"}

    CHECK_OPTS -- "Yes" --> EXIT_FAIL
    CHECK_OPTS -- "No" --> PROMPT{"Prompt User:<br/>Apply this fix? (y/N)"}

    PROMPT -- "Declined (N)" --> EXIT_FAIL
    PROMPT -- "Approved (y)" --> BACKUP["6. Backup Files to .explainfail/backups/"]
    
    BACKUP --> APPLY["7. Apply Fix<br/>(Whitelisted command or file write)"]
    APPLY --> RERUN["8. Re-run Identical Command<br/>(Stream output &amp; monitor timeout)"]

    RERUN --> EVAL{"Evaluate Result &amp;<br/>Compare F_after vs F_before"}

    EVAL -- "Exit 0" --> PASS["PASS: Fixed!<br/>(Run any --also checks)"]
    EVAL -- "Timed out running" --> STAYED["STAYED_UP<br/>(No known error seen)"]
    EVAL -- "Same Fingerprint" --> SAME["SAME_ERROR<br/>(Offer backup revert)"]
    EVAL -- "Different Fingerprint" --> NEW_ERR{"NEW_ERROR<br/>Rounds &lt; Max?"}

    NEW_ERR -- "Yes" --> FINGERPRINT
    NEW_ERR -- "No (Limit reached)" --> MAX_ROUNDS["Stop: Max rounds reached"]

    PASS --> LOG["9. Write Run Log<br/>.explainfail/runs/&lt;ts&gt;.json"]
    STAYED --> LOG
    SAME --> LOG
    MAX_ROUNDS --> LOG
    LOG --> END(["Finish"])
```

### Interactive Diagnosis Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant CLI as CLI (explainfail)
    participant Runner as Runner (execa)
    participant Engine as Diagnosis Engine
    participant Detector as Detector (e.g. port-in-use)
    participant OS as Host Machine / OS
    participant Backup as Backup Manager

    User->>CLI: explainfail npm run dev
    CLI->>Runner: Spawn child process
    Runner-->>CLI: Live stream output & exit code != 0
    CLI->>Engine: Diagnose Context (output, exit code)
    Engine->>Detector: match(output)
    Detector-->>Engine: Match data (e.g. port 3000)
    Engine->>Detector: gather(Context, match)
    Detector->>OS: Query listener (lsof / netstat)
    OS-->>Detector: PID 4821 listening on port 3000
    Detector-->>Engine: Verified Evidence [Port: 3000, PID: 4821]
    Engine-->>CLI: Validated Diagnosis & Whitelisted Fixes
    CLI-->>User: Display Evidence & Prompt: "Apply this fix? (y/N)"
    User->>CLI: y (approve)
    CLI->>Backup: Snapshot affected state / files
    CLI->>Runner: Execute fix (terminate PID 4821)
    CLI->>Runner: Re-run "npm run dev"
    Runner-->>CLI: Exit code 0 (PASS)
    CLI-->>User: ✔ PASS: command now exits with code 0.
```

---

## The 8 Detectors

Detectors are evaluated in a fixed priority order. Each detector gathers concrete system evidence before any fix can be suggested:

| Priority | Detector | Trigger Pattern | Evidence Gathered (Machine Proof) | Proposed Fix | Risk |
|:---:|---|---|---|---|:---:|
| 1 | `port-in-use` | `EADDRINUSE`, `address already in use` | Active listening PID, process name, and port (via `lsof`/`ss` on POSIX, `netstat`/`tasklist` on Windows). | Terminate blocking process PID; or manual alternative port instructions. | `medium` / `manual` |
| 2 | `node-version` | `Unsupported engine`, `incompatible module`, `requires Node` | Current `process.version` compared with `.nvmrc`, `.node-version`, or `package.json -> engines.node`. | Suggest exact `nvm use`, `fnm use`, or `volta pin` commands. | `manual` |
| 3 | `module-not-found` | `Cannot find module`, `ERR_MODULE_NOT_FOUND` | Verification whether file path exists or package is listed in `package.json` + read-only registry check (`npm view`). | Run package manager install (`npm install`); or guide file path correction. | `low` / `medium` / `manual` |
| 4 | `eresolve` | `npm ERR! code ERESOLVE` | Verbatim dependency conflict tree lines (`Found:`, `Could not resolve dependency`, `peer`). | Align versions manually; or re-run command with `--legacy-peer-deps`. | `manual` / `medium` |
| 5 | `lockfile-sync` | `npm ci can only install...`, `ERR_PNPM_OUTDATED_LOCKFILE` | Lockfile existence and diff between `package.json` and lockfile manifests. | Re-generate lockfile (`npm install`, `pnpm install --no-frozen-lockfile`). | `medium` |
| 6 | `eacces` | `EACCES`, `EPERM` | File/directory permissions (`fs.stat`, UID, GID, octal mode) vs current runtime user. | Print safe `chown` text or npm global prefix documentation. | `manual` |
| 7 | `env-missing` | Preflight check / Post-failure finding | Compares variable keys in `.env.example` vs `.env` (never reads secret values). | Create `.env` from template or append missing keys (`KEY=`). | `low` / `medium` |
| 8 | `merge-conflict` | Git conflict markers in failure trace / text scan | Detects unmerged files containing `<<<<<<<`, `=======`, and `>>>>>>>` markers. | Lists file paths and marker line numbers for manual resolution. | `manual` |

---

## How explainfail Avoids Guessing

Traditional tools and AI assistants frequently hallucinate solutions or guess what might be wrong. `explainfail` enforces strict architectural principles:

1. **Deterministic Rules Only**: No LLM or AI inference calls are used in the diagnostic engine. Every diagnosis is triggered by deterministic pattern matching.
2. **Evidence-First Rule**: A match is not enough. The engine requires verified machine evidence (e.g., inspecting the filesystem, checking open ports, or evaluating semver ranges). **If evidence cannot be confirmed, the diagnosis is rejected.**
3. **Honest Fallback**: When no rule matches with verified evidence, `explainfail` outputs an explicit, honest fallback message with a web search link. It never invents a plausible-sounding guess:
   ```text
   explainfail could not confirm a cause for this failure. No rule matched with evidence.
   Last error line: <errorLine>
   Search: https://www.google.com/search?q=<url-encoded errorLine>
   ```
4. **Whitelisted Fixes with Permission**: Only explicit, pre-defined fixes constructed inside detector modules can run. `explainfail` never executes arbitrary generated shell scripts.
5. **Always Verify by Re-running**: A problem is only marked resolved when the original command is re-executed and passes (exit code 0).
6. **Zero Setup & Offline**: Runs entirely locally using native Node.js APIs and five minimal, audited dependencies.

---

## Honest Limitations

- `explainfail` does **not** find logic bugs. Exit code 0 means *"the command ran without a known error"*, not *"your code is correct"*.
- It can only explain the 8 known problem types in v1. Anything else gets the *"could not confirm"* message.
- Node version changes (`nvm`/`fnm`/`volta`) must be done by you; `explainfail` only tells you what to run.
- No PTY: some tools print less color/progress when run through `explainfail`.
- Windows support is partial in v1 (port detection works; permission diagnosis does not).
- `STAYED_UP` is not proof of a clean exit.

---

## Privacy & Security

- **Zero Telemetry**: No analytics, tracking, or network calls home.
- **Strict Secret Redaction**: The redaction engine (`src/redact.js`) sanitizes:
  - Bearer tokens (`Bearer <token>`)
  - Provider keys (`sk-...`, `ghp_...`, `AKIA...`, `xox...`)
  - Private key blocks (`-----BEGIN ... PRIVATE KEY-----`)
  - Query string and config passwords (`password=...`, `token=...`, `secret=...`, `apikey=...`)
  - Embedded URL credentials (`https://user:pass@host`)
- **Safe Environment Handling**: `.env` and `.env.*` values are never read, printed, or saved. Only variable key names are parsed from `.env.example`.
- **Command Injection Prevention**: Multi-argument commands are executed via direct `argv` arrays without shell interpolation.

---

## Contributing & Extending

Each detector is completely self-contained in `src/detectors/`:

```
src/detectors/
├── index.js             # Exports ordered array of active detectors
├── port-in-use.js       # Detector 1
├── node-version.js      # Detector 2
├── module-not-found.js  # Detector 3
├── eresolve.js          # Detector 4
├── lockfile-sync.js     # Detector 5
├── eacces.js            # Detector 6
├── env-missing.js       # Detector 7
└── merge-conflict.js    # Detector 8
```

### The Detector Interface

To add a detector, export an object satisfying the `Detector` contract:

```javascript
/**
 * @typedef {Object} Detector
 * @property {string} id Unique identifier (e.g., 'port-in-use')
 * @property {string} title Human-readable description
 * @property {(ctx: Context) => (Match|null)} match Pure regex check on ctx.output (no I/O)
 * @property {(ctx: Context, m: Match) => Promise<Evidence[]|null>} gather Read-only machine inspection
 * @property {(m: Match, ev: Evidence[]) => string} explain Clear explanation using gathered evidence
 * @property {(ctx: Context, m: Match, ev: Evidence[]) => Fix[]} fixes Whitelisted executable or manual fixes
 * @property {(ctx: Context) => Promise<Finding[]>} [preflight] Optional doctor preflight check
 */
```

### Running Tests

```bash
# Run unit, integration, and fixture tests offline
npm test
```

---

## License

[MIT](LICENSE)
