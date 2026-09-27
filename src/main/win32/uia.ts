// Reads the address of the page shown in a browser window through Windows UI Automation (the
// accessibility API screen readers use). Chromium exposes each page as a "Document" element
// whose Value is its URL. This reads nothing else from the page and changes nothing in it.
//
// UI Automation calls are synchronous cross-process calls, so run this off the main thread
// (see urlReader.ts).
import koffi from 'koffi';

const ole32 = koffi.load('ole32.dll');
const oleaut32 = koffi.load('oleaut32.dll');

koffi.struct('MGV_UIA_GUID', { Data1: 'uint32', Data2: 'uint16', Data3: 'uint16', Data4: koffi.array('uint8', 8, 'Array') });
// VARIANT (24 bytes on x64): vt + padding, then an 8-byte value (enough for VT_I4 / VT_BSTR).
koffi.struct('MGV_VARIANT', { vt: 'uint16', r1: 'uint16', r2: 'uint16', r3: 'uint16', val: 'uint64', pad: 'uint64' });
koffi.struct('MGV_VARIANT_OUT', { vt: 'uint16', r1: 'uint16', r2: 'uint16', r3: 'uint16', val: 'void *', pad: 'uint64' });

type Guid = { Data1: number; Data2: number; Data3: number; Data4: number[] };
function guid(s: string): Guid {
  const h = s.replace(/[{}-]/g, '');
  const bytes: number[] = [];
  for (let i = 16; i < 32; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16));
  return { Data1: parseInt(h.slice(0, 8), 16), Data2: parseInt(h.slice(8, 12), 16), Data3: parseInt(h.slice(12, 16), 16), Data4: bytes };
}

const CLSID_CUIAutomation = guid('FF48DBA4-60EF-4201-AA87-54103EEF594E');
const IID_IUIAutomation = guid('30CBE57D-D9D0-452A-AB13-7AC5AC4825EE');

const CoInitializeEx = ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 flags)');
const CoCreateInstance = ole32.func('int32 __stdcall CoCreateInstance(MGV_UIA_GUID *clsid, void *outer, uint32 ctx, MGV_UIA_GUID *iid, _Out_ void **ppv)');
const SysFreeString = oleaut32.func('void __stdcall SysFreeString(void *bstr)');

const P = {
  Release: koffi.proto('uint32 __stdcall MGV_UIA_Release(void *self)'),
  ElementFromHandle: koffi.proto('int32 __stdcall MGV_UIA_ElementFromHandle(void *self, intptr_t hwnd, _Out_ void **el)'),
  CreatePropertyCondition: koffi.proto('int32 __stdcall MGV_UIA_CreatePropertyCondition(void *self, int32 prop, MGV_VARIANT value, _Out_ void **cond)'),
  FindFirst: koffi.proto('int32 __stdcall MGV_UIA_FindFirst(void *self, int32 scope, void *cond, _Out_ void **found)'),
  GetCurrentPropertyValue: koffi.proto('int32 __stdcall MGV_UIA_GetCurrentPropertyValue(void *self, int32 prop, _Out_ MGV_VARIANT_OUT *value)'),
};
const VT = { Release: 2, ElementFromHandle: 6, CreatePropertyCondition: 23, FindFirst: 5, GetCurrentPropertyValue: 10 };

const UIA_ControlTypePropertyId = 30003;
const UIA_ValueValuePropertyId = 30045;
const UIA_DocumentControlTypeId = 50030;
const TreeScope_Descendants = 4;
const VT_I4 = 3;
const VT_BSTR = 8;

type Ptr = unknown;

function call(obj: Ptr, index: number, proto: ReturnType<typeof koffi.proto>, ...args: unknown[]): number {
  const vtbl = koffi.decode(obj, 'void *');
  const fn = koffi.decode(vtbl, index * koffi.sizeof('void *'), 'void *');
  return koffi.call(fn, proto, obj, ...args) as number;
}

function release(obj: Ptr | null): void {
  if (obj) call(obj, VT.Release, P.Release);
}

let automation: Ptr | null = null;
let documentCondition: Ptr | null = null;

function init(): boolean {
  if (automation) return true;
  CoInitializeEx(null, 0x0); // COINIT_MULTITHREADED on this worker thread
  const out: Ptr[] = [null];
  if (CoCreateInstance(CLSID_CUIAutomation, null, 0x1 /* CLSCTX_INPROC_SERVER */, IID_IUIAutomation, out) !== 0) return false;
  automation = out[0];
  const cond: Ptr[] = [null];
  const hr = call(automation, VT.CreatePropertyCondition, P.CreatePropertyCondition, UIA_ControlTypePropertyId, { vt: VT_I4, r1: 0, r2: 0, r3: 0, val: UIA_DocumentControlTypeId, pad: 0 }, cond);
  if (hr !== 0) return false;
  documentCondition = cond[0];
  return true;
}

/**
 * URL of the page in `hwnd`, or null if it isn't available yet. The first request for a
 * window makes the browser build its accessibility tree, so callers should retry briefly.
 */
export function readDocumentUrl(hwnd: number): string | null {
  if (!init()) return null;
  const el: Ptr[] = [null];
  if (call(automation, VT.ElementFromHandle, P.ElementFromHandle, hwnd, el) !== 0 || !el[0]) return null;
  const doc: Ptr[] = [null];
  try {
    if (call(el[0], VT.FindFirst, P.FindFirst, TreeScope_Descendants, documentCondition, doc) !== 0 || !doc[0]) return null;
    const v = {} as { vt: number; val: unknown };
    if (call(doc[0], VT.GetCurrentPropertyValue, P.GetCurrentPropertyValue, UIA_ValueValuePropertyId, v) !== 0) return null;
    if (v.vt !== VT_BSTR || !v.val) return null;
    const url = koffi.decode(v.val, 'char16_t', -1) as string;
    SysFreeString(v.val);
    return url || null;
  } finally {
    release(doc[0]);
    release(el[0]);
  }
}
