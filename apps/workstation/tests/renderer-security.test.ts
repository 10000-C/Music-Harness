import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rendererHtmlPath = fileURLToPath(
  new URL('../src/renderer/index.html', import.meta.url),
);

describe('Renderer document security', () => {
  it('ships a restrictive CSP without unsafe script evaluation', () => {
    const html = readFileSync(rendererHtmlPath, 'utf8');
    const policy =
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u.exec(
        html,
      )?.[1];

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("'wasm-unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
  });
});
