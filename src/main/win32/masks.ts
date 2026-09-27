// Gap masks as bare Win32 popup windows painted by a black class brush. They are far cheaper
// than browser windows (no renderer process) and, unlike Chromium windows, have no minimum
// size, so they can be exactly as thin as the gap. They never take focus.
import koffi from 'koffi';
import type { Rect } from '../../shared/types';
import { C, W, gdi32, kernel32, user32 } from './native';

const WNDCLASSEXW = koffi.struct('MGV_WNDCLASSEXW', {
  cbSize: 'uint32',
  style: 'uint32',
  lpfnWndProc: 'void *',
  cbClsExtra: 'int',
  cbWndExtra: 'int',
  hInstance: 'intptr_t',
  hIcon: 'intptr_t',
  hCursor: 'intptr_t',
  hbrBackground: 'intptr_t',
  lpszMenuName: 'const char16_t *',
  lpszClassName: 'const char16_t *',
  hIconSm: 'intptr_t',
});

const GetModuleHandleW = kernel32.func('intptr_t __stdcall GetModuleHandleW(const char16_t *name)');
const GetProcAddress = kernel32.func('void * __stdcall GetProcAddress(intptr_t module, const char *name)');
const RegisterClassExW = user32.func('uint16 __stdcall RegisterClassExW(MGV_WNDCLASSEXW *cls)');
const CreateWindowExW = user32.func(
  'intptr_t __stdcall CreateWindowExW(uint32 exStyle, const char16_t *cls, const char16_t *title, uint32 style, int x, int y, int w, int h, intptr_t parent, intptr_t menu, intptr_t inst, void *param)',
);
const DestroyWindow = user32.func('int __stdcall DestroyWindow(intptr_t hwnd)');
const ShowWindow = user32.func('int __stdcall ShowWindow(intptr_t hwnd, int cmd)');
const GetStockObject = gdi32.func('intptr_t __stdcall GetStockObject(int obj)');

const CLASS_NAME = 'MultiGameViewerGapMask';
const WS_POPUP = 0x80000000;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_NOACTIVATE = 0x08000000;
const BLACK_BRUSH = 4;
const SW_HIDE = 0;

let registered = false;

function ensureClass(): void {
  if (registered) return;
  const hInstance = GetModuleHandleW(null);
  const atom = RegisterClassExW({
    cbSize: koffi.sizeof(WNDCLASSEXW),
    style: 0,
    // Default window procedure: erases with the class brush, never activates (WS_EX_NOACTIVATE).
    lpfnWndProc: GetProcAddress(GetModuleHandleW('user32.dll'), 'DefWindowProcW'),
    cbClsExtra: 0,
    cbWndExtra: 0,
    hInstance,
    hIcon: 0,
    hCursor: 0,
    hbrBackground: GetStockObject(BLACK_BRUSH),
    lpszMenuName: null,
    lpszClassName: CLASS_NAME,
    hIconSm: 0,
  });
  if (!atom) throw new Error('RegisterClassExW failed for gap masks');
  registered = true;
}

export class GapMasks {
  private hwnds: number[] = [];

  /** Show one mask per rect (physical pixels); returns the HWNDs in use. */
  place(rects: readonly Rect[]): number[] {
    ensureClass();
    while (this.hwnds.length < rects.length) {
      const h = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, CLASS_NAME, 'MultiGame Viewer gap', WS_POPUP, 0, 0, 1, 1, 0, 0, GetModuleHandleW(null), null);
      if (!h) break;
      this.hwnds.push(h);
    }
    this.hwnds.forEach((h, i) => {
      const r = rects[i];
      if (!r) return void ShowWindow(h, SW_HIDE);
      W.SetWindowPos(h, 0, r.x, r.y, r.width, r.height, C.SWP_NOZORDER | C.SWP_NOACTIVATE | 0x0040 /* SWP_SHOWWINDOW */);
    });
    return this.hwnds.slice(0, rects.length);
  }

  hideAll(): void {
    for (const h of this.hwnds) ShowWindow(h, SW_HIDE);
  }

  owns(hwnd: number): boolean {
    return this.hwnds.includes(hwnd);
  }

  dispose(): void {
    for (const h of this.hwnds) DestroyWindow(h);
    this.hwnds = [];
  }
}
