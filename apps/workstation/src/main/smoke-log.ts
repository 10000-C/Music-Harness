import type { Writable } from 'node:stream';

const isBrokenPipe = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'EPIPE';

/** Writes smoke diagnostics without allowing a closed parent pipe to crash Main. */
export const writeSmokeLog = (message: string, output: Writable = process.stdout): void => {
  if (output.destroyed || output.writableEnded) return;

  const onError = (error: Error): void => {
    output.removeListener('error', onError);
    if (!isBrokenPipe(error)) throw error;
  };

  output.once('error', onError);
  try {
    output.write(`${message}\n`, () => output.removeListener('error', onError));
  } catch (error) {
    output.removeListener('error', onError);
    if (!isBrokenPipe(error)) throw error;
  }
};
