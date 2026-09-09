import { describe, expect, it } from 'vitest';
import {
  canonicalizeExternalAbc,
  compileComposition,
} from '../src/core/composition/index.js';
import { CurrentPlaybackSession } from '../src/renderer/opendaw-runtime/current-playback-session.js';
import { createInMemoryPlaybackRuntime } from '../src/renderer/opendaw-runtime/testing.js';

const compilation = () =>
  compileComposition(
    canonicalizeExternalAbc(`X:1
T:Session
M:4/4
L:1/4
Q:1/4=120
K:C
V:track.drums
V:track.bass
V:track.guitar
V:track.keys
V:track.strings
V:track.winds
[V:track.drums] z4 |
[V:track.bass] C,4 |
[V:track.guitar] E4 |
[V:track.keys] C4 |
[V:track.strings] G4 |
[V:track.winds] c4 |`),
  ).playback;

describe('CurrentPlaybackSession', () => {
  it('disposes a failed runtime and creates a clean replacement on retry', async () => {
    let created = 0;
    let disposed = 0;
    const states: (string | null)[] = [];
    const session = new CurrentPlaybackSession(
      () => {
        created += 1;
        return createInMemoryPlaybackRuntime({
          failLoadAfterApply: () => created === 1,
          beforeDispose: () => {
            disposed += 1;
          },
        });
      },
      (state) => states.push(state?.lifecycle ?? null),
    );
    const input = { revision: 'current-1', compilation: compilation() };

    await expect(session.load(input)).resolves.toMatchObject({
      status: 'failed',
    });
    expect(disposed).toBe(1);
    await expect(session.load(input)).resolves.toEqual({ status: 'ready' });
    expect(created).toBe(2);
    await session.clear();
    expect(disposed).toBe(2);
    expect(states.at(-1)).toBeNull();
  });
});
