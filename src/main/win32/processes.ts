// Process inspection: finding the viewer's browser processes by their --user-data-dir,
// walking the process tree, and sampling CPU/memory for the stats panel.
import koffi from 'koffi';
import { processTypeOf, userDataDirMatches } from '../../core/browsers';
import { C, PROCESS_MEMORY_COUNTERS_EX, PROCESSENTRY32W, W } from './native';

export interface ProcInfo {
  pid: number;
  ppid: number;
  exe: string;
}

export function snapshotProcesses(): ProcInfo[] {
  const snap = Number(W.CreateToolhelp32Snapshot(C.TH32CS_SNAPPROCESS, 0));
  if (snap === C.INVALID_HANDLE_VALUE || snap === 0) return [];
  const out: ProcInfo[] = [];
  try {
    const entry = { dwSize: PROCESSENTRY32W_SIZE } as { dwSize: number; th32ProcessID: number; th32ParentProcessID: number; szExeFile: string };
    let ok = W.Process32FirstW(snap, entry) !== 0;
    while (ok) {
      out.push({ pid: entry.th32ProcessID, ppid: entry.th32ParentProcessID, exe: entry.szExeFile });
      entry.dwSize = PROCESSENTRY32W_SIZE;
      ok = W.Process32NextW(snap, entry) !== 0;
    }
  } finally {
    W.CloseHandle(snap);
  }
  return out;
}

// Struct sizes: Process32First/Next and K32GetProcessMemoryInfo require them up front.
const PROCESSENTRY32W_SIZE = koffi.sizeof(PROCESSENTRY32W);
const PMC_SIZE = koffi.sizeof(PROCESS_MEMORY_COUNTERS_EX);

function withProcess<T>(pid: number, access: number, fn: (h: number) => T, fallback: T): T {
  const h = Number(W.OpenProcess(access, 0, pid));
  if (!h) return fallback;
  try {
    return fn(h);
  } finally {
    W.CloseHandle(h);
  }
}

const cmdlineCache = new Map<number, string>();
const STATUS_INFO_LENGTH_MISMATCH = -1073741820;
const ProcessCommandLineInformation = 60;

/** Command line of another process (same user). Cached per pid; call `pruneCaches` with live pids. */
export function commandLineOf(pid: number): string | null {
  const cached = cmdlineCache.get(pid);
  if (cached !== undefined) return cached;
  const value = withProcess(
    pid,
    C.PROCESS_QUERY_LIMITED_INFORMATION,
    (h) => {
      let size = 8192;
      for (let attempt = 0; attempt < 3; attempt++) {
        const buf = Buffer.alloc(size);
        const ret = [0];
        const status = W.NtQueryInformationProcess(h, ProcessCommandLineInformation, buf, size, ret);
        if (status === STATUS_INFO_LENGTH_MISMATCH || (status < 0 && ret[0] > size)) {
          size = ret[0] + 64;
          continue;
        }
        if (status < 0) return null;
        // UNICODE_STRING { USHORT Length; USHORT Max; PWSTR Buffer } followed by the text.
        const len = buf.readUInt16LE(0);
        const offset = 16;
        if (offset + len > buf.length) return null;
        return buf.toString('utf16le', offset, offset + len);
      }
      return null;
    },
    null,
  );
  if (value !== null) cmdlineCache.set(pid, value);
  return value;
}

export function pruneCaches(live: ReadonlySet<number>): void {
  for (const pid of cmdlineCache.keys()) if (!live.has(pid)) cmdlineCache.delete(pid);
  for (const pid of cpuPrev.keys()) if (!live.has(pid)) cpuPrev.delete(pid);
}

/** Browser (not child) processes of `exeName` that were started with our --user-data-dir. */
export function findBrowserProcesses(procs: readonly ProcInfo[], exeName: string, userDataDir: string): number[] {
  const name = exeName.toLowerCase();
  return procs
    .filter((p) => p.exe.toLowerCase() === name)
    .filter((p) => {
      const cmd = commandLineOf(p.pid);
      return cmd !== null && processTypeOf(cmd) === 'browser' && userDataDirMatches(cmd, userDataDir);
    })
    .map((p) => p.pid);
}

export function processTree(procs: readonly ProcInfo[], rootPid: number): ProcInfo[] {
  const byParent = new Map<number, ProcInfo[]>();
  for (const p of procs) {
    const list = byParent.get(p.ppid) ?? [];
    list.push(p);
    byParent.set(p.ppid, list);
  }
  const root = procs.find((p) => p.pid === rootPid);
  if (!root) return [];
  const out: ProcInfo[] = [root];
  for (let i = 0; i < out.length; i++) {
    for (const child of byParent.get(out[i].pid) ?? []) if (child.pid !== out[i].pid) out.push(child);
  }
  return out;
}

export function isProcessAlive(pid: number): boolean {
  return withProcess(
    pid,
    C.PROCESS_QUERY_LIMITED_INFORMATION,
    (h) => {
      const code = [0];
      return W.GetExitCodeProcess(h, code) !== 0 && code[0] === C.STILL_ACTIVE;
    },
    false,
  );
}

export function terminateProcess(pid: number): boolean {
  return withProcess(pid, C.PROCESS_TERMINATE, (h) => W.TerminateProcess(h, 1) !== 0, false);
}

const cpuPrev = new Map<number, { cpu100ns: number; at: number }>();

/** CPU% (of one core) consumed by `pid` since the previous call for the same pid. */
export function sampleCpuPercent(pid: number, now = Date.now()): number {
  const cpu = withProcess(
    pid,
    C.PROCESS_QUERY_LIMITED_INFORMATION,
    (h) => {
      const c = {}, e = {}, k = { low: 0, high: 0 }, u = { low: 0, high: 0 };
      if (!W.GetProcessTimes(h, c, e, k, u)) return -1;
      return (k.high * 4294967296 + k.low) + (u.high * 4294967296 + u.low);
    },
    -1,
  );
  if (cpu < 0) return 0;
  const prev = cpuPrev.get(pid);
  cpuPrev.set(pid, { cpu100ns: cpu, at: now });
  if (!prev || now <= prev.at) return 0;
  return Math.max(0, ((cpu - prev.cpu100ns) / 10000 / (now - prev.at)) * 100);
}

/** Private (commit) bytes of `pid`, which is what Task Manager calls "Memory". */
export function privateBytes(pid: number): number {
  return withProcess(
    pid,
    C.PROCESS_QUERY_LIMITED_INFORMATION,
    (h) => {
      const pmc = {} as { PrivateUsage: number | bigint };
      return W.K32GetProcessMemoryInfo(h, pmc, PMC_SIZE) ? Number(pmc.PrivateUsage) : 0;
    },
    0,
  );
}

/** A handle kept open on a process so its exit code can be read after it exits. */
export class ProcessWatch {
  private handle: number;

  constructor(readonly pid: number) {
    this.handle = Number(W.OpenProcess(C.SYNCHRONIZE | C.PROCESS_QUERY_LIMITED_INFORMATION, 0, pid));
  }

  /** null while running (or unknown), otherwise the exit code. */
  exitCode(): number | null {
    if (!this.handle) return null;
    const code = [0];
    if (W.GetExitCodeProcess(this.handle, code) === 0 || code[0] === C.STILL_ACTIVE) return null;
    return code[0];
  }

  close(): void {
    if (this.handle) W.CloseHandle(this.handle);
    this.handle = 0;
  }
}
