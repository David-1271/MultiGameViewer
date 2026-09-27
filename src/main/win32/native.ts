// Raw Win32 bindings via koffi (prebuilt FFI; no native compilation needed).
// Everything here is standard window management / process inspection that any window
// manager or task manager uses. HWNDs and HANDLEs are represented as JS numbers.
import koffi from 'koffi';

export const user32 = koffi.load('user32.dll');
export const gdi32 = koffi.load('gdi32.dll');
export const kernel32 = koffi.load('kernel32.dll');
export const ntdll = koffi.load('ntdll.dll');
export const shcore = koffi.load('shcore.dll');
export const dwmapi = koffi.load('dwmapi.dll');

koffi.alias('HWND', 'intptr_t');
koffi.alias('HANDLE', 'intptr_t');
koffi.alias('HRGN', 'intptr_t');
koffi.alias('HMONITOR', 'intptr_t');

export const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
export const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });
export const MONITORINFO = koffi.struct('MONITORINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' });
export const FILETIME = koffi.struct('FILETIME', { low: 'uint32', high: 'uint32' });
export const PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
  dwSize: 'uint32',
  cntUsage: 'uint32',
  th32ProcessID: 'uint32',
  th32DefaultHeapID: 'uintptr_t',
  th32ModuleID: 'uint32',
  cntThreads: 'uint32',
  th32ParentProcessID: 'uint32',
  pcPriClassBase: 'int32',
  dwFlags: 'uint32',
  szExeFile: koffi.array('char16_t', 260, 'String'),
});
export const PROCESS_MEMORY_COUNTERS_EX = koffi.struct('PROCESS_MEMORY_COUNTERS_EX', {
  cb: 'uint32',
  PageFaultCount: 'uint32',
  PeakWorkingSetSize: 'size_t',
  WorkingSetSize: 'size_t',
  QuotaPeakPagedPoolUsage: 'size_t',
  QuotaPagedPoolUsage: 'size_t',
  QuotaPeakNonPagedPoolUsage: 'size_t',
  QuotaNonPagedPoolUsage: 'size_t',
  PagefileUsage: 'size_t',
  PeakPagefileUsage: 'size_t',
  PrivateUsage: 'size_t',
});

export interface WinRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const EnumWindowsProc = koffi.proto('int __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)');
export const WinEventProc = koffi.proto(
  'void __stdcall WinEventProc(intptr_t hook, uint32 event, HWND hwnd, int32 idObject, int32 idChild, uint32 thread, uint32 time)',
);

export const W = {
  EnumWindows: user32.func('int __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
  GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32 *pid)'),
  IsWindow: user32.func('int __stdcall IsWindow(HWND hwnd)'),
  IsWindowVisible: user32.func('int __stdcall IsWindowVisible(HWND hwnd)'),
  IsIconic: user32.func('int __stdcall IsIconic(HWND hwnd)'),
  IsZoomed: user32.func('int __stdcall IsZoomed(HWND hwnd)'),
  IsHungAppWindow: user32.func('int __stdcall IsHungAppWindow(HWND hwnd)'),
  GetClassNameW: user32.func('int __stdcall GetClassNameW(HWND hwnd, _Out_ char16_t *buf, int max)'),
  GetWindowTextW: user32.func('int __stdcall GetWindowTextW(HWND hwnd, _Out_ char16_t *buf, int max)'),
  GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(HWND hwnd, int index)'),
  GetWindowRect: user32.func('int __stdcall GetWindowRect(HWND hwnd, _Out_ RECT *rect)'),
  GetClientRect: user32.func('int __stdcall GetClientRect(HWND hwnd, _Out_ RECT *rect)'),
  ClientToScreen: user32.func('int __stdcall ClientToScreen(HWND hwnd, _Inout_ POINT *pt)'),
  SetWindowPos: user32.func('int __stdcall SetWindowPos(HWND hwnd, HWND after, int x, int y, int cx, int cy, uint32 flags)'),
  SetWindowRgn: user32.func('int __stdcall SetWindowRgn(HWND hwnd, HRGN rgn, int redraw)'),
  GetWindowRgnBox: user32.func('int __stdcall GetWindowRgnBox(HWND hwnd, _Out_ RECT *rect)'),
  ShowWindowAsync: user32.func('int __stdcall ShowWindowAsync(HWND hwnd, int cmd)'),
  PostMessageW: user32.func('int __stdcall PostMessageW(HWND hwnd, uint32 msg, uintptr_t wParam, intptr_t lParam)'),
  GetForegroundWindow: user32.func('HWND __stdcall GetForegroundWindow()'),
  SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(HWND hwnd)'),
  SetWinEventHook: user32.func('intptr_t __stdcall SetWinEventHook(uint32 eventMin, uint32 eventMax, intptr_t hmod, WinEventProc *cb, uint32 pid, uint32 tid, uint32 flags)'),
  UnhookWinEvent: user32.func('int __stdcall UnhookWinEvent(intptr_t hook)'),
  keybd_event: user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)'),
  GetDpiForWindow: user32.func('uint32 __stdcall GetDpiForWindow(HWND hwnd)'),
  MonitorFromRect: user32.func('HMONITOR __stdcall MonitorFromRect(RECT *rect, uint32 flags)'),
  MonitorFromWindow: user32.func('HMONITOR __stdcall MonitorFromWindow(HWND hwnd, uint32 flags)'),
  GetMonitorInfoW: user32.func('int __stdcall GetMonitorInfoW(HMONITOR mon, _Inout_ MONITORINFO *info)'),
  GetDpiForMonitor: shcore.func('int32 __stdcall GetDpiForMonitor(HMONITOR mon, int type, _Out_ uint32 *x, _Out_ uint32 *y)'),
  CreateRectRgn: gdi32.func('HRGN __stdcall CreateRectRgn(int l, int t, int r, int b)'),
  DeleteObject: gdi32.func('int __stdcall DeleteObject(intptr_t obj)'),
  DwmSetWindowAttribute: dwmapi.func('int32 __stdcall DwmSetWindowAttribute(HWND hwnd, uint32 attr, _In_ uint32 *value, uint32 size)'),

  OpenProcess: kernel32.func('HANDLE __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)'),
  CloseHandle: kernel32.func('int __stdcall CloseHandle(HANDLE h)'),
  CreateToolhelp32Snapshot: kernel32.func('HANDLE __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)'),
  Process32FirstW: kernel32.func('int __stdcall Process32FirstW(HANDLE snap, _Inout_ PROCESSENTRY32W *entry)'),
  Process32NextW: kernel32.func('int __stdcall Process32NextW(HANDLE snap, _Inout_ PROCESSENTRY32W *entry)'),
  GetProcessTimes: kernel32.func(
    'int __stdcall GetProcessTimes(HANDLE h, _Out_ FILETIME *creation, _Out_ FILETIME *exit, _Out_ FILETIME *kernel, _Out_ FILETIME *user)',
  ),
  GetExitCodeProcess: kernel32.func('int __stdcall GetExitCodeProcess(HANDLE h, _Out_ uint32 *code)'),
  K32GetProcessMemoryInfo: kernel32.func('int __stdcall K32GetProcessMemoryInfo(HANDLE h, _Out_ PROCESS_MEMORY_COUNTERS_EX *pmc, uint32 cb)'),
  TerminateProcess: kernel32.func('int __stdcall TerminateProcess(HANDLE h, uint32 code)'),
  NtQueryInformationProcess: ntdll.func(
    'int32 __stdcall NtQueryInformationProcess(HANDLE h, int32 infoClass, _Out_ uint8_t *buf, uint32 len, _Out_ uint32 *retLen)',
  ),
};

export const C = {
  GWL_STYLE: -16,
  GWL_EXSTYLE: -20,
  WS_CAPTION: 0x00c00000,
  WS_EX_TOOLWINDOW: 0x00000080,
  WS_EX_TOPMOST: 0x00000008,
  HWND_TOP: 0,
  HWND_BOTTOM: 1,
  HWND_TOPMOST: -1,
  HWND_NOTOPMOST: -2,
  SWP_NOSIZE: 0x0001,
  SWP_NOMOVE: 0x0002,
  SWP_NOZORDER: 0x0004,
  SWP_NOACTIVATE: 0x0010,
  SWP_NOOWNERZORDER: 0x0200,
  SWP_ASYNCWINDOWPOS: 0x4000,
  SW_MINIMIZE: 6,
  SW_SHOWMINNOACTIVE: 7,
  SW_SHOWNOACTIVATE: 4,
  SW_RESTORE: 9,
  WM_CLOSE: 0x0010,
  MONITOR_DEFAULTTONEAREST: 2,
  MDT_EFFECTIVE_DPI: 0,
  NULLREGION: 1,
  ERROR_REGION: 0,
  PROCESS_QUERY_LIMITED_INFORMATION: 0x1000,
  PROCESS_TERMINATE: 0x0001,
  SYNCHRONIZE: 0x00100000,
  VK_F5: 0x74,
  KEYEVENTF_KEYUP: 0x0002,
  TH32CS_SNAPPROCESS: 0x00000002,
  STILL_ACTIVE: 259,
  DWMWA_WINDOW_CORNER_PREFERENCE: 33,
  DWMWA_BORDER_COLOR: 34,
  DWMWCP_DONOTROUND: 1,
  INVALID_HANDLE_VALUE: -1,
} as const;

export function makeEnumCallback(fn: (hwnd: number) => boolean) {
  return koffi.register((hwnd: number) => (fn(hwnd) ? 1 : 0), koffi.pointer(EnumWindowsProc));
}

export function unregisterCallback(cb: unknown): void {
  koffi.unregister(cb as never);
}

export function readWideString(buf: Buffer, chars: number): string {
  return buf.toString('utf16le', 0, Math.max(0, chars) * 2);
}
