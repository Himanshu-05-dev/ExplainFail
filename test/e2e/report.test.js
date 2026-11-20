import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { formatForAi, runReport } from '../../src/report.js';

test('report --for-ai produces exact required markdown sections', () => {
  const sampleLog = {
    command: 'npm run dev',
    startedAt: '2026-11-20T17:00:00.000Z',
    finalStatus: 'PASS',
    rounds: [
      {
        round: 1,
        fingerprintBefore: { exitCode: 1, errorLine: 'Error: listen EADDRINUSE :::3000' },
        diagnoses: [
          {
            id: 'port-in-use',
            kind: 'cause',
            evidence: [
              { label: 'Port', value: '3000' },
              { label: 'PID', value: '1234' }
            ]
          }
        ],
        fixApplied: { id: 'kill-process', label: 'Stop process 1234.', risk: 'medium' },
        result: 'PASS',
        fingerprintAfter: { exitCode: 0 }
      }
    ]
  };

  const md = formatForAi(sampleLog);

  assert.ok(md.includes('# explainfail report'));
  assert.ok(md.includes('## Command'));
  assert.ok(md.includes('## Verified facts (checked by explainfail on this machine)'));
  assert.ok(md.includes('- Port: 3000 [cause]'));
  assert.ok(md.includes('- PID: 1234 [cause]'));
  assert.ok(md.includes('## Environment'));
  assert.ok(md.includes('## Error (last 80 lines of output, redacted)'));
  assert.ok(md.includes('## Already tried (do not repeat)'));
  assert.ok(md.includes('Stop process 1234. → result: PASS'));
});

test('runReport returns 1 when no run log is present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainfail-no-run-'));
  try {
    const code = runReport({ cwd: tmpDir });
    assert.equal(code, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
