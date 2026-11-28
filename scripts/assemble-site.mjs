#!/usr/bin/env node
// Assemble le site publié : le code (site/), les données utiles au site (catalogue, instantané, historiques,
// prix TCGplayer, empreintes du scanner) et le service worker prêt pour le hors connexion.
// Usage : node scripts/assemble-site.mjs <dossier des données> <dossier de sortie>
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSw } from './build-sw.mjs';

const exists = (path) => stat(path).then(() => true, () => false);

export async function assembleSite(dataDir, outDir) {
  const site = fileURLToPath(new URL('../site', import.meta.url));
  await rm(outDir, { recursive: true, force: true });
  await cp(site, outDir, { recursive: true, filter: (src) => !src.startsWith(join(site, 'data')) }); // site/data : lien local éventuel
  await mkdir(join(outDir, 'data'), { recursive: true });
  for (const file of ['catalog.json', 'snapshot.json']) await cp(join(dataDir, file), join(outDir, 'data', file));
  await cp(join(dataDir, 'history'), join(outDir, 'data', 'history'), { recursive: true });
  if (await exists(join(dataDir, 'us'))) await cp(join(dataDir, 'us'), join(outDir, 'data', 'us'), { recursive: true });
  if (await exists(join(dataDir, 'fingerprints.bin'))) await cp(join(dataDir, 'fingerprints.bin'), join(outDir, 'data', 'fingerprints.bin'));
  return buildSw(outDir);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dataDir, outDir] = process.argv.slice(2);
  if (!dataDir || !outDir) { console.error('Usage : node scripts/assemble-site.mjs <données> <sortie>'); process.exit(1); }
  const { version, files } = await assembleSite(dataDir, outDir);
  console.log(`Site assemblé dans ${outDir} : version ${version}, ${files.length} fichiers gardés hors connexion`);
}
