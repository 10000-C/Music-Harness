import { describe, expect, it } from 'vitest';

import { TRACK_IDS, type TaskScope, type Tick } from '@agent-music/contracts';

import {
  CompositionValidationError,
  canonicalizeExternalAbc,
  compileComposition,
  getScopedComposition,
  isScopeMappingCacheValid,
  queryScopeMapping,
} from './index.js';

const tick = (value: number): Tick => value as Tick;

const composition = (drumBody: string, otherBody = drumBody): string => `X:1
T:Scope fixture
M:4/4
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map(
  (trackId) =>
    `[V:${trackId}] ${trackId === 'track.drums' ? drumBody : otherBody}`,
).join('\n')}
`;

describe('Scope Mapping cache', () => {
  it('binds deterministic six-track event spans to source, parser, and PPQ', () => {
    const source = canonicalizeExternalAbc(composition('C D E F |'));
    const result = compileComposition(source);

    expect(result.scopeMapping.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.scopeMapping.parserVersion).toBe('abcjs@6.6.4');
    expect(result.scopeMapping.ppq).toBe(960);
    expect(result.scopeMapping.tracks['track.drums']).toHaveLength(4);
    expect(isScopeMappingCacheValid(result.scopeMapping, source)).toBe(true);
    expect(
      isScopeMappingCacheValid(
        result.scopeMapping,
        source.replace('C D', 'D C'),
      ),
    ).toBe(false);

    const repeated = compileComposition(source);
    expect(repeated.scopeMapping).toEqual(result.scopeMapping);
  });

  it('uses half-open containment and reports crossing ties as protected', () => {
    const source = canonicalizeExternalAbc(
      composition('C2-C2 | D2 z2 |', 'z4 | z4 |'),
    );
    const result = compileComposition(source);
    const scope: TaskScope = {
      type: 'timeRange',
      trackIds: ['track.drums'],
      startTick: tick(1920),
      endTick: tick(5760),
    };

    const query = queryScopeMapping(result.scopeMapping, scope, tick(7680));

    expect(query.tracks[0]?.entries).toEqual([
      expect.objectContaining({ startTick: 3840, endTick: 5760 }),
    ]);
    expect(query.tracks[0]?.protectedEntries).toEqual([
      expect.objectContaining({ startTick: 0, endTick: 3840 }),
    ]);

    const scoped = getScopedComposition(result, scope);
    expect(scoped.tracks[0]).toMatchObject({
      trackId: 'track.drums',
      abc: 'D2',
      protectedEvents: [{ type: 'note', startTick: 0, endTick: 3840 }],
    });
    expect(JSON.stringify(scoped)).not.toContain('startChar');
    expect(scoped.context).toMatchObject({
      meter: { numerator: 4, denominator: 4 },
      tempo: { bpm: 120 },
      key: { tonic: 'C', accidental: '', mode: '' },
    });
  });

  it('binds a velocity directive to the same Scope span as its note', () => {
    const source = canonicalizeExternalAbc(
      composition('[I:MIDI vol 52]C D E F |'),
    );
    const result = compileComposition(source);
    const scoped = getScopedComposition(result, {
      type: 'timeRange',
      trackIds: ['track.drums'],
      startTick: tick(0),
      endTick: tick(960),
    });

    expect(scoped.tracks[0]?.abc).toBe('[I:MIDI vol 52] C');
    expect(result.scopeMapping.tracks['track.drums'][0]?.abcSpans).toHaveLength(
      2,
    );
  });

  it('matches an independent containment filter for deterministic ranges', () => {
    const body = Array.from({ length: 7 }, () => 'C D E F |').join(' ');
    const source = canonicalizeExternalAbc(composition(body));
    const result = compileComposition(source);
    const entries = result.scopeMapping.tracks['track.keys'];

    let state = 0x5eed;
    const random = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state;
    };

    for (let index = 0; index < 500; index += 1) {
      const left = random() % 26_880;
      const right = random() % 26_880;
      const startTick = Math.min(left, right);
      const endTick = Math.max(left, right) + 1;
      const scope: TaskScope = {
        type: 'timeRange',
        trackIds: ['track.keys'],
        startTick: tick(startTick),
        endTick: tick(endTick),
      };
      const actual = queryScopeMapping(
        result.scopeMapping,
        scope,
        result.totalTicks,
      ).tracks[0]?.entries;
      const expected = entries.filter(
        (entry) => entry.startTick >= startTick && entry.endTick <= endTick,
      );
      expect(actual).toEqual(expected);
    }
  });

  it('rejects stale caches and scopes outside the composition', () => {
    const source = canonicalizeExternalAbc(composition('z4 |'));
    const result = compileComposition(source);
    const stale = {
      ...result,
      canonicalAbc: result.canonicalAbc.replace('z4', 'C4'),
    };
    const scope: TaskScope = {
      type: 'wholeProject',
      trackIds: ['track.drums'],
    };

    expect(() => getScopedComposition(stale, scope)).toThrow(
      CompositionValidationError,
    );
    expect(() =>
      queryScopeMapping(
        result.scopeMapping,
        {
          type: 'timeRange',
          trackIds: ['track.drums'],
          startTick: tick(0),
          endTick: tick(4000),
        },
        result.totalTicks,
      ),
    ).toThrow(CompositionValidationError);
  });
});
