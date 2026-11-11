import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { siteFiles, injectSw, buildSw } from '../scripts/build-sw.mjs';

test('injectSw remplace la version et la liste, et refuse un sw.js inattendu', () => {
  const src = "const VERSION = 'dev';\nconst PRECACHE = [];\n";
  assert.equal(injectSw(src, { version: 'abc', files: ['index.html'] }), "const VERSION = 'abc';\nconst PRECACHE = [\"index.html\"];\n");
  assert.throws(() => injectSw('rien', { version: 'abc', files: [] }));
});

test('buildSw : liste le site sans les données ni sw.js ; la version ne bouge pas avec les données', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'site-'));
  await mkdir(join(dir, 'views'));
  await mkdir(join(dir, 'data/history'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<p>');
  await writeFile(join(dir, 'views/card.js'), 'x');
  await writeFile(join(dir, 'data/snapshot.json'), '{}');
  await writeFile(join(dir, 'data/history/SV8a.json'), '{}');
  await cp(new URL('../site/sw.js', import.meta.url), join(dir, 'sw.js'));
  assert.deepEqual(await siteFiles(dir), ['index.html', 'views/card.js']);

  const pristine = await readFile(join(dir, 'sw.js'), 'utf8');
  const first = await buildSw(dir);
  assert.match(await readFile(join(dir, 'sw.js'), 'utf8'), /const PRECACHE = \["index.html","views\/card.js"\];/);

  await writeFile(join(dir, 'sw.js'), pristine);
  await writeFile(join(dir, 'data/snapshot.json'), '{"date":"2026-11-12"}');
  assert.equal((await buildSw(dir)).version, first.version);

  await writeFile(join(dir, 'sw.js'), pristine);
  await writeFile(join(dir, 'views/card.js'), 'y');
  assert.notEqual((await buildSw(dir)).version, first.version);
});

test('le site publie tout ce que le manifeste et la page annoncent', async () => {
  const manifest = JSON.parse(await readFile(new URL('../site/manifest.webmanifest', import.meta.url), 'utf8'));
  const files = await siteFiles(new URL('../site', import.meta.url).pathname);
  for (const icon of manifest.icons) assert.ok(files.includes(icon.src), icon.src);
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  for (const [, href] of html.matchAll(/(?:href|src)="(?!https?:|#)([^"]+)"/g)) assert.ok(files.includes(href), href);
});
