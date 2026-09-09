import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const workstationPath = fileURLToPath(new URL('..', import.meta.url));
const electronPath = join(
  workstationPath,
  'node_modules',
  'electron',
  'dist',
  'electron.exe',
);
const mainPath = join(workstationPath, 'out', 'main', 'index.js');

test('runs the isolated SpessaSynth AudioWorklet capability probe', async () => {
  const child = spawn(electronPath, [mainPath], {
    cwd: workstationPath,
    env: {
      ...process.env,
      AGENT_MUSIC_FAKE_SERVICES: '1',
      AGENT_MUSIC_SMOKE: '1',
      AGENT_MUSIC_SPESSA_SPIKE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  let errorOutput = '';
  child.stdout.on('data', (value: Buffer) => {
    output += value.toString();
  });
  child.stderr.on('data', (value: Buffer) => {
    errorOutput += value.toString();
  });

  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `SpessaSynth smoke timed out. stdout:\n${output}\nstderr:\n${errorOutput}`,
          ),
        );
      }, 45_000);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    expect(exitCode).toBe(0);
    expect(output).toContain('SMOKE:renderer-loaded');
    expect(output).toContain('SMOKE:services-ready');
    expect(output).toContain('SMOKE:complete');
    const marker = output
      .split(/\r?\n/u)
      .find((line) => line.startsWith('SMOKE:spessasynth:'));
    expect(
      marker,
      `No SpessaSynth result marker. stdout:\n${output}\nstderr:\n${errorOutput}`,
    ).toBeDefined();
    const state = JSON.parse(
      marker?.slice('SMOKE:spessasynth:'.length) ?? '{}',
    ) as {
      require?: string;
      process?: string;
      ipc?: string;
      bridge?: string[];
      report?: {
        status?: string;
        phase?: string;
        error?: string;
        checks?: { id?: string; status?: string }[];
        runtime?: {
          analyserPeak?: number;
          editedAnalyserPeak?: number;
          maxVoiceCount?: number;
          channelVoiceCounts?: number[];
          switchedPrograms?: number[];
          controllers?: Record<string, number>;
          muteTransition?: boolean[];
          adapterAnalyserPeak?: number;
          adapterMutedPeak?: number;
          adapterSoloPeak?: number;
          adapterPositionTick?: number;
          adapterLoopPositionTick?: number;
          adapterDisposed?: boolean;
        };
      };
    };
    expect(state).toMatchObject({
      require: 'undefined',
      process: 'undefined',
      ipc: 'undefined',
      bridge: [
        'chooseExportPath',
        'chooseProjectDirectory',
        'dispatchProject',
        'getServiceSnapshot',
        'onServiceSnapshot',
        'readCurrentPlayback',
        'restartService',
      ],
    });
    expect(
      state.report,
      `SpessaSynth probe failed. stdout:\n${output}\nstderr:\n${errorOutput}`,
    ).toMatchObject({
      status: 'passed',
      phase: 'complete',
      runtime: {
        switchedPrograms: [1, 0],
        controllers: {
          '71': 76,
          '72': 68,
          '73': 60,
          '74': 84,
          '91': 42,
          '93': 34,
        },
        muteTransition: [true, false],
        adapterDisposed: true,
      },
    });
    const passedChecks = new Set(
      state.report?.checks
        ?.filter((check) => check.status === 'passed')
        .map((check) => check.id),
    );
    expect(passedChecks).toEqual(
      new Set([
        'midi-import',
        'midi-musical-metadata',
        'midi-multiple-channels',
        'midi-edit-roundtrip',
        'soundfont-import',
        'soundfont-multiple-presets',
        'audio-worklet-ready',
        'independent-preset-control',
        'independent-mix-control',
        'mute-control',
        'tone-and-space-controls',
        'multi-track-playback',
        'multi-channel-voices',
        'edited-midi-playback',
        'adapter-runtime-source-switch',
        'adapter-track-controls',
        'adapter-transport-position',
        'adapter-loop-observed',
        'adapter-mute-solo-audio',
        'adapter-dispose',
      ]),
    );
    expect(state.report?.runtime?.analyserPeak).toBeGreaterThan(0.0001);
    expect(state.report?.runtime?.editedAnalyserPeak).toBeGreaterThan(0.0001);
    expect(state.report?.runtime?.maxVoiceCount).toBeGreaterThanOrEqual(2);
    expect(state.report?.runtime?.adapterAnalyserPeak).toBeGreaterThan(0.0001);
    expect(state.report?.runtime?.adapterSoloPeak).toBeGreaterThan(0.0001);
    expect(state.report?.runtime?.adapterMutedPeak).toBeLessThan(
      (state.report?.runtime?.adapterSoloPeak ?? 0) * 0.5,
    );
    expect(state.report?.runtime?.adapterPositionTick).toBeGreaterThan(0);
    expect(
      state.report?.runtime?.adapterLoopPositionTick,
    ).toBeGreaterThanOrEqual(480);
    expect(state.report?.runtime?.adapterLoopPositionTick).toBeLessThan(960);
    expect(state.report?.runtime?.channelVoiceCounts).toEqual(
      expect.arrayContaining([expect.any(Number), expect.any(Number)]),
    );
    expect(errorOutput).not.toContain('Uncaught (in promise)');
    expect(errorOutput).not.toContain('Refused to');
  } finally {
    if (child.exitCode === null) {
      if (process.platform === 'win32' && child.pid !== undefined) {
        await new Promise<void>((resolve) => {
          execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {
            resolve();
          });
        });
      } else {
        child.kill();
      }
    }
    child.stdout.destroy();
    child.stderr.destroy();
  }
}, 60_000);
