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
