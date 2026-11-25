import test from 'node:test';
import assert from 'node:assert/strict';
import { frenchName } from '../scripts/lib/names.mjs';

const table = { Sylveon: 'Nymphali', Charizard: 'Dracaufeu', Mew: 'Mew2', Mewtwo: 'Mewtwo-fr', 'Mr. Mime': 'M. Mime', Meowth: 'Miaouss', Porygon: 'Porygon-fr', Porygon2: 'Porygon2-fr' };
const fr = (en) => frenchName(en, table);

test('remplace le nom d’espèce et retire la liste d’attaques', () => {
  assert.equal(fr('Sylveon ex [Magical Charm | Angelite]'), 'Nymphali ex');
  assert.equal(fr('Charizard'), 'Dracaufeu');
});
test('garde préfixes et suffixes', () => {
  assert.equal(fr("Team Rocket's Meowth [Paw-cket Pilfer]"), 'Miaouss de la Team Rocket');
  assert.equal(fr("Misty's Meowth"), 'Miaouss de Misty');
  assert.equal(fr('Mega Charizard X ex'), 'Méga-Dracaufeu X ex');
  assert.equal(fr('Mr. Mime V'), 'M. Mime V');
});
test('prend le nom le plus long et respecte les limites de mot', () => {
  assert.equal(fr('Mewtwo ex'), 'Mewtwo-fr ex');
  assert.equal(fr('Porygon2'), 'Porygon2-fr');
  assert.equal(fr('Mewing Cat'), null);
});
test('aucune espèce reconnue ou nom absent : null', () => {
  assert.equal(fr("Lillie's Determination"), null);
  assert.equal(fr(null), null);
  assert.equal(fr(''), null);
});

test('formes régionales : « Alolan X » devient « X d’Alola »', () => {
  assert.equal(fr('Alolan Meowth [Scratch]'), 'Miaouss d’Alola');
  assert.equal(fr('Galarian Meowth V'), 'Miaouss de Galar V');
  assert.equal(fr('Hisuian Charizard'), 'Dracaufeu de Hisui');
  assert.equal(fr('Paldean Mewtwo ex'), 'Mewtwo-fr de Paldea ex');
});

test('cartes à deux Pokémon : les deux noms sont traduits', () => {
  assert.equal(frenchName('Charizard & Sylveon GX [x]', table), 'Dracaufeu & Nymphali GX');
});
test('table vide ou absente : aucun nom inventé', () => {
  assert.equal(frenchName('Mr. Mime', {}), null);
  assert.equal(frenchName('Mr. Mime', null), null);
});
test('la table des espèces est bien dans le dépôt et complète', async () => {
  const { readFile } = await import('node:fs/promises');
  const species = JSON.parse(await readFile(new URL('../scripts/data/species-fr.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(species).length > 1000);
  assert.equal(species.Sylveon, 'Nymphali');
  assert.equal(species['Nidoran ♀'], 'Nidoran♀');
  assert.equal(frenchName('Sylveon ex [Magical Charm | Angelite]', species), 'Nymphali ex');
});
