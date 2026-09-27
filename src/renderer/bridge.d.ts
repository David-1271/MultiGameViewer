// Shape of the preload bridge (src/preload/preload.ts) as seen by the viewer's pages.
import type { UiCommand, UiState } from '../shared/types';

declare global {
  interface Window {
    mgv: { command(cmd: UiCommand): void; onState(cb: (state: UiState) => void): void };
  }
}
