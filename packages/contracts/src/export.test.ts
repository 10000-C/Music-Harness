import { describe, expect, it } from 'vitest';

import { isExportCommand } from './export.js';

describe('export contracts', () => {
  it('accepts only the exact Current export preparation command shape', () => {
    expect(
      isExportCommand({
        type: 'export.prepareCurrent',
        requestId: 'request-1',
      }),
    ).toBe(true);
    expect(
      isExportCommand({
        type: 'export.prepareCurrent',
        requestId: 'request-1',
        candidateId: 'must-not-enter-export',
      }),
    ).toBe(false);
    expect(
      isExportCommand({ type: 'export.prepareCurrent', requestId: 1 }),
    ).toBe(false);
  });
});
