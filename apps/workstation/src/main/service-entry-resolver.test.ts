import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolveServiceEntry } from './service-entry-resolver.js';

beforeEach(() => {
  delete process.env.AGENT_MUSIC_FAKE_SERVICES;
  delete process.env.AGENT_MUSIC_FAKE_AGENT;
  delete process.env.AGENT_MUSIC_REAL_CORE;
  delete process.env.AGENT_MUSIC_AGENT_ENTRY;
});

describe('resolveServiceEntry', () => {
  it('resolves the built-in entries by default', () => {
    expect(resolveServiceEntry('core')).toBe(
      join(__dirname, 'project-service-entry.js'),
    );
    expect(resolveServiceEntry('agent')).toBe(
      join(__dirname, 'agent-service-entry.js'),
    );
  });

  it('lets AGENT_MUSIC_AGENT_ENTRY override the agent entry', () => {
    process.env.AGENT_MUSIC_AGENT_ENTRY = 'D:/custom/agent-entry.mjs';
    expect(resolveServiceEntry('agent')).toBe('D:/custom/agent-entry.mjs');
    expect(resolveServiceEntry('core')).toBe(
      join(__dirname, 'project-service-entry.js'),
    );
  });

  it('routes both services to the fake entry in full fake mode', () => {
    process.env.AGENT_MUSIC_FAKE_SERVICES = '1';
    expect(resolveServiceEntry('core')).toBe(
      join(__dirname, 'fake-service-entry.js'),
    );
    expect(resolveServiceEntry('agent')).toBe(
      join(__dirname, 'fake-service-entry.js'),
    );
  });

  it('keeps the real core in fake-agent mode', () => {
    process.env.AGENT_MUSIC_FAKE_AGENT = '1';
    expect(resolveServiceEntry('core')).toBe(
      join(__dirname, 'project-service-entry.js'),
    );
    expect(resolveServiceEntry('agent')).toBe(
      join(__dirname, 'fake-service-entry.js'),
    );
  });
});
