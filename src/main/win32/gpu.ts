// GPU engine utilisation per process from the Windows performance counters (the same data
// Task Manager shows as "GPU" / "GPU engine"). Lets the stats panel show whether video is
// being decoded on the GPU's video-decode engine.
import koffi from 'koffi';

const pdh = koffi.load('pdh.dll');
const PdhOpenQueryW = pdh.func('uint32 __stdcall PdhOpenQueryW(const char16_t *src, uintptr_t user, _Out_ intptr_t *query)');
const PdhAddEnglishCounterW = pdh.func('uint32 __stdcall PdhAddEnglishCounterW(intptr_t query, const char16_t *path, uintptr_t user, _Out_ intptr_t *counter)');
const PdhCollectQueryData = pdh.func('uint32 __stdcall PdhCollectQueryData(intptr_t query)');
const PdhGetFormattedCounterArrayW = pdh.func(
  'uint32 __stdcall PdhGetFormattedCounterArrayW(intptr_t counter, uint32 format, _Inout_ uint32 *bufSize, _Out_ uint32 *count, uint8_t *buffer)',
);
const PdhCloseQuery = pdh.func('uint32 __stdcall PdhCloseQuery(intptr_t query)');

const PDH_FMT_DOUBLE = 0x00000200;
const PDH_MORE_DATA = 0x800007d2;
const ITEM_SIZE = 24; // PDH_FMT_COUNTERVALUE_ITEM_W on x64: name ptr, status, pad, double

export interface GpuUsage {
  /** Sum over the process's engines of the given type, in percent. */
  byType: Map<string, number>;
}

/** Instance names look like "pid_1234_luid_0x..._phys_0_eng_3_engtype_VideoDecode". */
export function parseEngineInstance(name: string): { pid: number; type: string } | null {
  const m = /^pid_(\d+)_.*_engtype_(.+)$/.exec(name);
  return m ? { pid: Number(m[1]), type: m[2].toLowerCase() } : null;
}

export class GpuSampler {
  private query = 0;
  private counter = 0;

  constructor(private readonly log: (msg: string) => void) {
    const q = [0];
    const c = [0];
    if (PdhOpenQueryW(null, 0, q) !== 0) return;
    if (PdhAddEnglishCounterW(q[0], '\\GPU Engine(*)\\Utilization Percentage', 0, c) !== 0) {
      PdhCloseQuery(q[0]);
      this.log('GPU engine performance counters are unavailable');
      return;
    }
    this.query = q[0];
    this.counter = c[0];
    PdhCollectQueryData(this.query); // rate counters need a first sample
  }

  get available(): boolean {
    return this.query !== 0;
  }

  /** GPU usage for each pid in `pids` since the previous call. */
  sample(pids: ReadonlySet<number>): Map<number, GpuUsage> {
    const out = new Map<number, GpuUsage>();
    if (!this.query || PdhCollectQueryData(this.query) !== 0) return out;
    const size = [0];
    const count = [0];
    let status = PdhGetFormattedCounterArrayW(this.counter, PDH_FMT_DOUBLE, size, count, null);
    if (status !== PDH_MORE_DATA || size[0] === 0) return out;
    const buf = Buffer.alloc(size[0]);
    status = PdhGetFormattedCounterArrayW(this.counter, PDH_FMT_DOUBLE, size, count, buf);
    if (status !== 0 || count[0] === 0) return out;
    // Names live in the same buffer right after the item array; turn pointers into offsets.
    const firstName = buf.readBigUInt64LE(0);
    const base = firstName - BigInt(count[0] * ITEM_SIZE);
    for (let i = 0; i < count[0]; i++) {
      const off = i * ITEM_SIZE;
      if (buf.readUInt32LE(off + 8) > 1) continue; // not valid data
      const start = Number(buf.readBigUInt64LE(off) - base);
      if (start < 0 || start >= buf.length) continue;
      let end = start;
      while (end + 1 < buf.length && (buf[end] !== 0 || buf[end + 1] !== 0)) end += 2;
      const inst = parseEngineInstance(buf.toString('utf16le', start, end));
      if (!inst || !pids.has(inst.pid)) continue;
      const usage = out.get(inst.pid) ?? { byType: new Map() };
      usage.byType.set(inst.type, (usage.byType.get(inst.type) ?? 0) + buf.readDoubleLE(off + 16));
      out.set(inst.pid, usage);
    }
    return out;
  }

  dispose(): void {
    if (this.query) PdhCloseQuery(this.query);
    this.query = 0;
  }
}
