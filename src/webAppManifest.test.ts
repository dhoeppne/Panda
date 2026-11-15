import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(
  readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'),
) as Record<string, unknown>;

describe('web app manifest', () => {
  it('is linked with a base-relative URL so it works at the Pages subpath', () => {
    expect(indexHtml).toContain('<link rel="manifest" href="manifest.webmanifest" />');
  });

  it('creates a standalone app whose scope excludes external origins', () => {
    expect(manifest).toMatchObject({
      start_url: './',
      scope: './',
      display: 'standalone',
    });
  });
});
