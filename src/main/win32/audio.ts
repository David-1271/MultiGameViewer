// Per-process mute through the Windows audio-session API (the same mechanism as the
// Volume Mixer). This controls the browser's audio output from outside the browser, so it
// needs no page access and keeps working whatever YouTube TV's page looks like.
//
// Chromium plays all of a browser's audio from one "audio service" utility process, so one
// shared browser = one session (master mute); one browser per game = per-game mute.
import koffi from 'koffi';

const ole32 = koffi.load('ole32.dll');

// Registers the MGV_GUID type referenced by name in the signatures below.
koffi.struct('MGV_GUID', { Data1: 'uint32', Data2: 'uint16', Data3: 'uint16', Data4: koffi.array('uint8', 8, 'Array') });
type Guid = { Data1: number; Data2: number; Data3: number; Data4: number[] };

function guid(s: string): Guid {
  const h = s.replace(/[{}-]/g, '');
  const bytes: number[] = [];
  for (let i = 16; i < 32; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16));
  return { Data1: parseInt(h.slice(0, 8), 16), Data2: parseInt(h.slice(8, 12), 16), Data3: parseInt(h.slice(12, 16), 16), Data4: bytes };
}

const CLSID_MMDeviceEnumerator = guid('BCDE0395-E52F-467C-8E3D-C4579291692E');
const IID_IMMDeviceEnumerator = guid('A95664D2-9614-4F35-A746-DE8DB63617E6');
const IID_IAudioSessionManager2 = guid('77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F');
const IID_IAudioSessionControl2 = guid('BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D');
const IID_ISimpleAudioVolume = guid('87CE5498-68D6-44E5-9215-6DA47EF883D8');

const CoInitializeEx = ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 flags)');
const CoCreateInstance = ole32.func('int32 __stdcall CoCreateInstance(MGV_GUID *clsid, void *outer, uint32 ctx, MGV_GUID *iid, _Out_ void **ppv)');
const CoTaskMemFree = ole32.func('void __stdcall CoTaskMemFree(void *p)');

// COM vtable method signatures (the object pointer is the first argument).
const P = {
  QueryInterface: koffi.proto('int32 __stdcall MGV_QueryInterface(void *self, MGV_GUID *iid, _Out_ void **ppv)'),
  Release: koffi.proto('uint32 __stdcall MGV_Release(void *self)'),
  EnumAudioEndpoints: koffi.proto('int32 __stdcall MGV_EnumAudioEndpoints(void *self, int flow, uint32 mask, _Out_ void **col)'),
  GetCountU: koffi.proto('int32 __stdcall MGV_GetCountU(void *self, _Out_ uint32 *n)'),
  Item: koffi.proto('int32 __stdcall MGV_Item(void *self, uint32 i, _Out_ void **dev)'),
  Activate: koffi.proto('int32 __stdcall MGV_Activate(void *self, MGV_GUID *iid, uint32 ctx, void *params, _Out_ void **out)'),
  GetSessionEnumerator: koffi.proto('int32 __stdcall MGV_GetSessionEnumerator(void *self, _Out_ void **e)'),
  GetCountI: koffi.proto('int32 __stdcall MGV_GetCountI(void *self, _Out_ int32 *n)'),
  GetSession: koffi.proto('int32 __stdcall MGV_GetSession(void *self, int32 i, _Out_ void **s)'),
  GetInstanceId: koffi.proto('int32 __stdcall MGV_GetInstanceId(void *self, _Out_ void **str)'),
  GetProcessId: koffi.proto('int32 __stdcall MGV_GetProcessId(void *self, _Out_ uint32 *pid)'),
  SetMute: koffi.proto('int32 __stdcall MGV_SetMute(void *self, int32 mute, void *ctx)'),
  GetMute: koffi.proto('int32 __stdcall MGV_GetMute(void *self, _Out_ int32 *mute)'),
};

const VT = {
  QueryInterface: 0,
  Release: 2,
  EnumAudioEndpoints: 3, // IMMDeviceEnumerator
  CollectionGetCount: 3, // IMMDeviceCollection
  CollectionItem: 4,
  Activate: 3, // IMMDevice
  GetSessionEnumerator: 5, // IAudioSessionManager2
  EnumGetCount: 3, // IAudioSessionEnumerator
  EnumGetSession: 4,
  GetSessionInstanceIdentifier: 13, // IAudioSessionControl2
  GetProcessId: 14,
  SetMute: 5, // ISimpleAudioVolume
  GetMute: 6,
};

type Ptr = unknown;

function method(obj: Ptr, index: number): Ptr {
  const vtbl = koffi.decode(obj, 'void *');
  return koffi.decode(vtbl, index * koffi.sizeof('void *'), 'void *');
}

function call(obj: Ptr, index: number, proto: ReturnType<typeof koffi.proto>, ...args: unknown[]): number {
  return koffi.call(method(obj, index), proto, obj, ...args) as number;
}

function release(obj: Ptr | null): void {
  if (obj) call(obj, VT.Release, P.Release);
}

function queryInterface(obj: Ptr, iid: Guid): Ptr | null {
  const out: Ptr[] = [null];
  return call(obj, VT.QueryInterface, P.QueryInterface, iid, out) === 0 ? out[0] : null;
}

const CLSCTX_ALL = 0x17;
const eRender = 0;
const DEVICE_STATE_ACTIVE = 1;

export interface AudioSession {
  pid: number;
  id: string;
  muted: boolean;
}

export class AudioSessionController {
  private enumerator: Ptr | null = null;
  /** session instance id -> mute state we last applied (so we don't fight the Volume Mixer). */
  private applied = new Map<string, boolean>();

  constructor(private readonly log: (msg: string, err?: unknown) => void) {}

  private ensure(): Ptr | null {
    if (this.enumerator) return this.enumerator;
    CoInitializeEx(null, 0x2); // STA; S_FALSE/RPC_E_CHANGED_MODE are fine (already initialised)
    const out: Ptr[] = [null];
    const hr = CoCreateInstance(CLSID_MMDeviceEnumerator, null, CLSCTX_ALL, IID_IMMDeviceEnumerator, out);
    if (hr !== 0) {
      this.log(`MMDeviceEnumerator unavailable (hr=0x${(hr >>> 0).toString(16)})`);
      return null;
    }
    this.enumerator = out[0];
    return this.enumerator;
  }

  /** Visit every audio session on every active output device. */
  private forEachSession(visit: (control2: Ptr, pid: number, id: string) => void): void {
    const en = this.ensure();
    if (!en) return;
    const colOut: Ptr[] = [null];
    if (call(en, VT.EnumAudioEndpoints, P.EnumAudioEndpoints, eRender, DEVICE_STATE_ACTIVE, colOut) !== 0) return;
    const col = colOut[0];
    try {
      const n = [0];
      call(col, VT.CollectionGetCount, P.GetCountU, n);
      for (let d = 0; d < n[0]; d++) {
        const devOut: Ptr[] = [null];
        if (call(col, VT.CollectionItem, P.Item, d, devOut) !== 0) continue;
        const dev = devOut[0];
        const mgrOut: Ptr[] = [null];
        const ok = call(dev, VT.Activate, P.Activate, IID_IAudioSessionManager2, CLSCTX_ALL, null, mgrOut) === 0;
        release(dev);
        if (!ok) continue;
        const mgr = mgrOut[0];
        const enumOut: Ptr[] = [null];
        const okEnum = call(mgr, VT.GetSessionEnumerator, P.GetSessionEnumerator, enumOut) === 0;
        release(mgr);
        if (!okEnum) continue;
        const sessions = enumOut[0];
        try {
          const count = [0];
          call(sessions, VT.EnumGetCount, P.GetCountI, count);
          for (let i = 0; i < count[0]; i++) {
            const ctlOut: Ptr[] = [null];
            if (call(sessions, VT.EnumGetSession, P.GetSession, i, ctlOut) !== 0) continue;
            const ctl = ctlOut[0];
            const ctl2 = queryInterface(ctl, IID_IAudioSessionControl2);
            release(ctl);
            if (!ctl2) continue;
            try {
              const pid = [0];
              call(ctl2, VT.GetProcessId, P.GetProcessId, pid);
              const idOut: Ptr[] = [null];
              let id = `${d}:${pid[0]}:${i}`;
              if (call(ctl2, VT.GetSessionInstanceIdentifier, P.GetInstanceId, idOut) === 0 && idOut[0]) {
                id = koffi.decode(idOut[0], 'char16_t', -1) as string;
                CoTaskMemFree(idOut[0]);
              }
              visit(ctl2, pid[0], id);
            } finally {
              release(ctl2);
            }
          }
        } finally {
          release(sessions);
        }
      }
    } finally {
      release(col);
    }
  }

  list(): AudioSession[] {
    const out: AudioSession[] = [];
    try {
      this.forEachSession((ctl2, pid, id) => {
        const vol = queryInterface(ctl2, IID_ISimpleAudioVolume);
        if (!vol) return;
        const m = [0];
        call(vol, VT.GetMute, P.GetMute, m);
        release(vol);
        out.push({ pid, id, muted: m[0] !== 0 });
      });
    } catch (err) {
      this.log('Audio session enumeration failed', err);
    }
    return out;
  }

  /**
   * Apply desired mute states. `desired(pid)` returns true/false for processes we manage and
   * undefined for everything else (other apps are never touched). New sessions, and sessions
   * whose desired state changed, are updated; with `force` every managed session is.
   */
  apply(desired: (pid: number) => boolean | undefined, force = false): number {
    let changed = 0;
    const seen = new Set<string>();
    try {
      this.forEachSession((ctl2, pid, id) => {
        const want = desired(pid);
        if (want === undefined) return;
        seen.add(id);
        if (!force && this.applied.get(id) === want) return;
        const vol = queryInterface(ctl2, IID_ISimpleAudioVolume);
        if (!vol) return;
        try {
          if (call(vol, VT.SetMute, P.SetMute, want ? 1 : 0, null) === 0) {
            this.applied.set(id, want);
            changed++;
          }
        } finally {
          release(vol);
        }
      });
    } catch (err) {
      this.log('Applying audio mute failed', err);
    }
    for (const id of this.applied.keys()) if (!seen.has(id)) this.applied.delete(id);
    return changed;
  }

  dispose(): void {
    release(this.enumerator);
    this.enumerator = null;
  }
}
