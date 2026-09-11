import type { PreparedCurrentExport, ProjectId } from '@agent-music/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompositionValidationError } from '../composition/index.js';
import { ProjectError } from '../project/project-error.js';
import {
  ExportIpcHandler,
  type ExportPreparationPort,
} from './export-ipc-handler.js';

const projectId = '00000000-0000-4000-8000-0000000000a5' as ProjectId;
const prepared: PreparedCurrentExport = {
  projectId,
  currentRevision: 'C1',
  canonicalAbc: 'X:1\nK:C\n',
  midiFileBytes: new Uint8Array([0x4d, 0x54, 0x68, 0x64]),
};

let prepareCurrentExport: ReturnType<typeof vi.fn>;
let handler: ExportIpcHandler;

beforeEach(() => {
  prepareCurrentExport = vi.fn(() => Promise.resolve(prepared));
  handler = new ExportIpcHandler({
    prepareCurrentExport,
  } as ExportPreparationPort);
});

describe('ExportIpcHandler', () => {
  it('routes Current preparation and emits monotonic typed events', async () => {
    await expect(
      handler.handle({ type: 'export.prepareCurrent', requestId: 'request-1' }),
    ).resolves.toEqual({
      type: 'export.prepared',
      requestId: 'request-1',
      sequence: 1,
      result: prepared,
    });
    await expect(
      handler.handle({ type: 'export.prepareCurrent', requestId: 'request-2' }),
    ).resolves.toMatchObject({ sequence: 2 });
    expect(prepareCurrentExport).toHaveBeenCalledTimes(2);
  });

  it('preserves stable Project failures and hides unexpected implementation details', async () => {
    prepareCurrentExport.mockRejectedValueOnce(
      new ProjectError(
        'CURRENT_WORKTREE_DIRTY',
        'Current worktree contains uncommitted changes',
      ),
    );
    prepareCurrentExport.mockRejectedValueOnce(new Error('secret path detail'));

    await expect(
      handler.handle({ type: 'export.prepareCurrent', requestId: 'request-1' }),
    ).resolves.toEqual({
      type: 'export.failed',
      requestId: 'request-1',
      sequence: 1,
      code: 'CURRENT_WORKTREE_DIRTY',
      message: 'Current worktree contains uncommitted changes',
    });
    await expect(
      handler.handle({ type: 'export.prepareCurrent', requestId: 'request-2' }),
    ).resolves.toEqual({
      type: 'export.failed',
      requestId: 'request-2',
      sequence: 2,
      code: 'EXPORT_PREPARATION_FAILED',
      message: 'Unexpected export preparation failure',
    });
  });

  it('normalizes final composition validation without exposing parser internals', async () => {
    prepareCurrentExport.mockRejectedValueOnce(
      new CompositionValidationError({
        code: 'METER_BARLINE_MISMATCH',
        message: 'internal validation detail',
      }),
    );

    await expect(
      handler.handle({ type: 'export.prepareCurrent', requestId: 'request-1' }),
    ).resolves.toEqual({
      type: 'export.failed',
      requestId: 'request-1',
      sequence: 1,
      code: 'VALIDATION_FAILED',
      message: 'Current composition is not exportable',
    });
  });
});
