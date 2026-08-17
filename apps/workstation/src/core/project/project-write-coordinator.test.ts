import { describe, expect, it, vi } from 'vitest';

import { ProjectWriteCoordinator } from './project-write-coordinator.js';

describe('ProjectWriteCoordinator', () => {
  it('runs project writes strictly in FIFO order', async () => {
    const assertOwned = vi.fn(async () => undefined);
    const order: string[] = [];
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const coordinator = new ProjectWriteCoordinator({ assertOwned });

    const first = coordinator.run(async () => {
      order.push('first:start');
      await gate;
      order.push('first:end');
    });
    const second = coordinator.run(async () => {
      order.push('second');
    });

    releaseGate();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
    expect(assertOwned).toHaveBeenCalledTimes(2);
  });

  it('continues the queue after a failed write', async () => {
    const coordinator = new ProjectWriteCoordinator({
      assertOwned: async () => undefined,
    });

    await expect(
      coordinator.run(async () => {
        throw new Error('injected');
      }),
    ).rejects.toThrow('injected');

    await expect(coordinator.run(async () => 'next')).resolves.toBe('next');
  });
});
