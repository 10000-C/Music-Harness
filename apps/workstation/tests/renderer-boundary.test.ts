import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rendererRoot = fileURLToPath(
  new URL('../src/renderer/', import.meta.url),
);

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : ['.ts', '.tsx'].includes(extname(entry.name))
        ? [path]
        : [];
  });

describe('Renderer architecture boundary', () => {
  it('does not import openDAW or Electron Main internals', () => {
    const sources = sourceFiles(rendererRoot).map((path) => ({
      path,
      source: readFileSync(path, 'utf8'),
    }));

    for (const { path, source } of sources) {
      expect(source, path).not.toMatch(/from\s+['"]@opendaw\//u);
      expect(source, path).not.toMatch(/from\s+['"][^'"]*\/main\//u);
      expect(source, path).not.toMatch(/from\s+['"]electron['"]/u);
    }
  });
});
