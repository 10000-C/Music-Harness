import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { writeSmokeLog } from './smoke-log.js';

describe('writeSmokeLog', () => {
  it('keeps diagnostics writable on a normal stream', () => {
    const output = new PassThrough();
    let text = '';
    output.on('data', (chunk: Buffer) => {
      text += chunk.toString();
    });
    writeSmokeLog('SMOKE:ready', output);
    expect(text).toBe('SMOKE:ready\n');
  });

  it('absorbs EPIPE reported asynchronously by the receiving stream', async () => {
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }));
      },
    });
    expect(() => writeSmokeLog('SMOKE:complete', output)).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
