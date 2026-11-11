// Prépare le service worker du site assemblé : liste des fichiers à garder hors connexion et version.
// Usage : node scripts/build-sw.mjs _site
// La version est l'empreinte du code du site : elle ne change que si le site change, pas avec les données.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP = (path) => path === 'sw.js' || path.startsWith('data/') || path === 'data';

/** Fichiers du site (chemins relatifs, triés), sans les données ni le service worker lui-même. */
export async function siteFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/');
    if (!SKIP(path) && !path.split('/').some((part) => part.startsWith('.'))) out.push(path);
  }
  return out.sort();
}

/** Remplace VERSION et PRECACHE dans le source du service worker. */
export function injectSw(source, { version, files }) {
  const withVersion = source.replace(/^const VERSION = '[^']*';$/m, `const VERSION = '${version}';`);
  const withFiles = withVersion.replace(/^const PRECACHE = \[\];$/m, `const PRECACHE = ${JSON.stringify(files)};`);
  if (withVersion === source || withFiles === withVersion) throw new Error('sw.js : VERSION ou PRECACHE introuvable');
  return withFiles;
}

export async function buildSw(dir) {
  const files = await siteFiles(dir);
  const swPath = join(dir, 'sw.js');
  const source = await readFile(swPath, 'utf8');
  const hash = createHash('sha256').update(source).update('\0'); // sw.js compte aussi, avant remplacement
  for (const file of files) hash.update(`${file}\0`).update(await readFile(join(dir, file))).update('\0');
  const version = hash.digest('hex').slice(0, 12);
  await writeFile(swPath, injectSw(source, { version, files }));
  return { version, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage : node scripts/build-sw.mjs <dossier du site>'); process.exit(1); }
  const { version, files } = await buildSw(dir);
  console.log(`sw.js : version ${version}, ${files.length} fichiers gardés hors connexion`);
}
