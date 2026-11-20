import { execa } from 'execa';
import { isWindows } from '../util/platform.js';

export const id = 'port-in-use';
export const title = 'Port already in use';

export function extractPort(output) {
  if (!output || typeof output !== 'string') return null;
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    if (/EADDRINUSE/i.test(line) || /already in use/i.test(line)) {
      const m1 = line.match(/(?:::|:)(\d{2,5})\b/);
      if (m1) return m1[1];
      const m2 = line.match(/address already in use\s+\S*:(\d{2,5})/i);
      if (m2) return m2[1];
      const m3 = line.match(/port\s+(\d{2,5})\s+is already in use/i);
      if (m3) return m3[1];
    }
  }
  return null;
}

export function match(ctx) {
  const output = ctx?.output || '';
  if (!/EADDRINUSE/i.test(output) && !/address already in use/i.test(output)) {
    return null;
  }

  const port = extractPort(output);
  if (!port) return null;

  return {
    detectorId: id,
    data: { port },
    matchedLines: output.split(/\r?\n/).filter((l) => /EADDRINUSE|address already in use/i.test(l))
  };
}

export async function findListener(port) {
  if (isWindows()) {
    try {
      const netstat = await execa('netstat', ['-ano', '-p', 'TCP'], { reject: false });
      if (!netstat.stdout) return null;
      
      const portRegex = new RegExp(`[:.]${port}\\s+.*LISTENING\\s+(\\d+)`, 'i');
      let pid = null;
      for (const line of netstat.stdout.split(/\r?\n/)) {
        const match = line.match(portRegex);
        if (match) {
          pid = match[1];
          break;
        }
      }

      if (!pid || pid === '0') return null;

      let processName = 'unknown';
      try {
        const tasklist = await execa('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { reject: false });
        if (tasklist.stdout) {
          const match = tasklist.stdout.match(/^"([^"]+)"/);
          if (match) {
            processName = match[1];
          }
        }
      } catch {
        // ignore
      }

      return { port, pid, processName, command: processName };
    } catch {
      return null;
    }
  } else {
    // macOS / Linux
    try {
      const lsof = await execa('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpcn'], { reject: false });
      if (lsof.stdout) {
        let pid = null;
        let command = null;
        for (const line of lsof.stdout.split('\n')) {
          if (line.startsWith('p')) pid = line.slice(1);
          if (line.startsWith('c')) command = line.slice(1);
        }
        if (pid) {
          return { port, pid, processName: command || 'node', command: command || 'node' };
        }
      }
    } catch {
      // Fallback on Linux to ss
      try {
        const ss = await execa('ss', ['-ltnp', `sport = :${port}`], { reject: false });
        if (ss.stdout) {
          const pidMatch = ss.stdout.match(/pid=(\d+)/);
          const nameMatch = ss.stdout.match(/users:\(\("([^"]+)"/);
          if (pidMatch) {
            return {
              port,
              pid: pidMatch[1],
              processName: nameMatch ? nameMatch[1] : 'unknown',
              command: nameMatch ? nameMatch[1] : 'unknown'
            };
          }
        }
      } catch {
        // ignore
      }
    }
    return null;
  }
}

export async function gather(ctx, m) {
  const port = m?.data?.port;
  if (!port) return null;

  const listener = await findListener(port);
  if (!listener || !listener.pid) {
    return null; // Evidence rule: if no listener currently found, do not produce diagnosis
  }

  const evidence = [
    { label: 'Port', value: String(listener.port) },
    { label: 'PID', value: String(listener.pid) },
    { label: 'Process', value: String(listener.processName) }
  ];

  if (listener.command && listener.command !== listener.processName) {
    evidence.push({ label: 'Command', value: String(listener.command) });
  }

  return evidence;
}

export function explain(m, ev) {
  const port = ev.find((e) => e.label === 'Port')?.value || m?.data?.port;
  const pid = ev.find((e) => e.label === 'PID')?.value || 'unknown';
  const processName = ev.find((e) => e.label === 'Process')?.value || 'process';
  return `Port ${port} is already being used by process ${pid} (${processName}).`;
}

export function fixes(ctx, m, ev) {
  const pidStr = ev.find((e) => e.label === 'PID')?.value;
  const port = ev.find((e) => e.label === 'Port')?.value || m?.data?.port;
  const result = [];

  const pid = pidStr ? parseInt(pidStr, 10) : null;
  // Guard: Never kill explainfail's own PID or parent PID
  if (pid && pid !== process.pid && pid !== process.ppid && pid > 0) {
    const isWin = isWindows();
    const argv = isWin ? ['taskkill', '/PID', String(pid), '/F'] : ['kill', '-TERM', String(pid)];

    result.push({
      id: 'kill-process',
      label: `Stop process ${pid}.`,
      type: 'command',
      risk: 'medium',
      argv,
      warning: 'This stops the process shown in the evidence.'
    });
  }

  result.push({
    id: 'change-port',
    label: `Use a different port instead of ${port}.`,
    type: 'manual',
    risk: 'low',
    manualText: `Configure your application to listen on an available port (e.g. PORT=${Number(port) + 1} <your command>).`
  });

  return result;
}

export default {
  id,
  title,
  match,
  gather,
  explain,
  fixes,
  extractPort,
  findListener
};
