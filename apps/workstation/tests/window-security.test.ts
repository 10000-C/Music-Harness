import { describe, expect, it } from 'vitest';
import { secureWebPreferences } from '../src/main/create-main-window.js';

describe('main window security', () => {
  it('uses an isolated sandboxed preload with no Node integration', () => {
    const preferences = secureWebPreferences();
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.sandbox).toBe(true);
    expect(preferences.preload).toMatch(/preload[\\/]index\.cjs$/u);
  });
});
