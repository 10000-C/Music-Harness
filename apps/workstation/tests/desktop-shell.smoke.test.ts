import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
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

test('launches the isolated desktop shell with fake services', async () => {
  const child = spawn(electronPath, [mainPath], {
    cwd: workstationPath,
    env: {
      ...process.env,
      AGENT_MUSIC_FAKE_SERVICES: '1',
      AGENT_MUSIC_SMOKE: '1',
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
            `Electron smoke timed out. stdout:\n${output}\nstderr:\n${errorOutput}`,
          ),
        );
      }, 30_000);
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
      .find((line) => line.startsWith('SMOKE:renderer-security:'));
    expect(marker).toBeDefined();
    const state = JSON.parse(
      marker?.slice('SMOKE:renderer-security:'.length) ?? '{}',
    ) as {
      require?: string;
      process?: string;
      ipc?: string;
      bridge?: string[];
      snapshot?: { core?: string; agent?: string };
      ui?: { shell?: boolean; trackCount?: number; agentTitle?: string };
    };
    expect(state).toMatchObject({
      require: 'undefined',
      process: 'undefined',
      ipc: 'undefined',
      bridge: [
        'chooseExportPath',
        'chooseProjectDirectory',
        'getServiceSnapshot',
        'onServiceSnapshot',
        'restartService',
      ],
    });
    expect(['starting', 'ready']).toContain(state.snapshot?.core);
    expect(['starting', 'ready']).toContain(state.snapshot?.agent);
    expect(
      state.ui,
      `Electron UI state was incomplete. stdout:\n${output}\nstderr:\n${errorOutput}`,
    ).toEqual({
      shell: true,
      trackCount: 6,
      agentTitle: 'MUSE Agent',
    });
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
}, 45_000);
