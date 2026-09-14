import { describe, expect, it } from 'vitest';
import {
  getRovingTabIndex,
  getTrappedTabIndex,
} from '../src/renderer/workspace/a11y-keyboard.js';

describe('accessible keyboard navigation', () => {
  it('moves and wraps between tabs in both directions', () => {
    expect(getRovingTabIndex('ArrowRight', 0, 2)).toBe(1);
    expect(getRovingTabIndex('ArrowRight', 1, 2)).toBe(0);
    expect(getRovingTabIndex('ArrowLeft', 0, 2)).toBe(1);
    expect(getRovingTabIndex('ArrowLeft', 1, 2)).toBe(0);
  });

  it('moves directly to the first or last tab', () => {
    expect(getRovingTabIndex('Home', 1, 2)).toBe(0);
    expect(getRovingTabIndex('End', 0, 2)).toBe(1);
    expect(getRovingTabIndex('End', 0, 0)).toBe(-1);
  });

  it('cycles focus inside a dialog for Tab and Shift+Tab', () => {
    expect(getTrappedTabIndex(0, 2, false)).toBe(1);
    expect(getTrappedTabIndex(1, 2, false)).toBe(0);
    expect(getTrappedTabIndex(1, 2, true)).toBe(0);
    expect(getTrappedTabIndex(0, 2, true)).toBe(1);
  });

  it('enters the focus cycle safely when focus starts outside', () => {
    expect(getTrappedTabIndex(-1, 2, false)).toBe(0);
    expect(getTrappedTabIndex(-1, 2, true)).toBe(1);
    expect(getTrappedTabIndex(-1, 0, false)).toBe(-1);
  });
});
