import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

test('launches with real Core (MCP server) and real Agent child process', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'amw-real-project-'));
  const homeDirectory = await mkdtemp(join(tmpdir(), 'amw-real-home-'));
  const runtimeDescriptorPath = join(homeDirectory, 'runtime', 'core.json');

  // Do NOT pass AGENT_MUSIC_FAKE_AGENT or AGENT_MUSIC_FAKE_SERVICES:
  // this test verifies the production Core process hosting MusicCoreMcpHttpServer
  // and the production Agent process connecting via the runtime descriptor.
  const child = spawn(electronPath, [mainPath], {
    cwd: workstationPath,
    env: {
      ...process.env,
      AGENT_MUSIC_HOME: homeDirectory,
      AGENT_MUSIC_SMOKE: '1',
      AGENT_MUSIC_WINDOW_WIDTH: '1280',
      AGENT_MUSIC_B2_SMOKE_PROJECT: projectPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let output = '';
  let errorOutput = '';
  let descriptorCaptured: {
    endpoint: string;
    instanceToken: string;
    pid: number;
  } | null = null as {
    endpoint: string;
    instanceToken: string;
    pid: number;
  } | null;

  child.stdout.on('data', (value: Buffer) => {
    const text = value.toString();
    output += text;
    if (text.includes('SMOKE:services-ready') && descriptorCaptured === null) {
      void (async () => {
        try {
          const raw = await readFile(runtimeDescriptorPath, 'utf8');
          descriptorCaptured = JSON.parse(raw) as typeof descriptorCaptured;
        } catch {
          // Handled in assertion below
        }
      })();
    }
  });

  child.stderr.on('data', (value: Buffer) => {
    errorOutput += value.toString();
  });

  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Real services smoke timed out. stdout:\n${output}\nstderr:\n${errorOutput}`,
          ),
        );
      }, 40_000);
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

    // Verify the runtime descriptor was published during operation
    if (descriptorCaptured !== null) {
      const descriptor = descriptorCaptured;
      expect(descriptor.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      expect(typeof descriptor.instanceToken).toBe('string');
      expect(descriptor.instanceToken.length).toBeGreaterThan(0);
      expect(descriptor.pid).toBeGreaterThan(0);
    }

    // After shutdown, the Core MCP server should have cleaned up core.json
    await expect(stat(runtimeDescriptorPath)).rejects.toMatchObject({
      code: 'ENOENT',
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
    await Promise.all([
      rm(projectPath, { recursive: true, force: true }),
      rm(homeDirectory, { recursive: true, force: true }),
    ]);
  }
}, 45_000);
