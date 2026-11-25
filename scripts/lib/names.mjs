/**
 * Nom français d'une carte à partir de son nom anglais Cardmarket.
 * Seuls les noms d'espèces de Pokémon sont traduits (table PokeAPI en → fr, scripts/data/species-fr.json) ;
 * une carte Dresseur ou Énergie, sans espèce reconnue, renvoie null et garde son nom d'origine.
 */
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compiled = new WeakMap();

function matcher(table) {
  if (!compiled.has(table)) {
    const names = Object.keys(table).filter(Boolean).sort((a, b) => b.length - a.length); // le plus long d'abord : Porygon2 avant Porygon
    // Table vide : aucune traduction (une expression vide reconnaîtrait n'importe quoi).
    compiled.set(table, names.length
      ? new RegExp(`(?<![\\p{L}\\p{N}])(${names.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
      : null);
  }
  return compiled.get(table);
}

export function frenchName(en, table) {
  if (!en || !table) return null;
  const re = matcher(table);
  if (!re) return null;
  const name = en.replace(/\s*\[.*\]\s*$/, '').trim();
  const found = name.match(re); // toutes les espèces du nom (cartes à deux Pokémon : « Celebi & Venusaur GX »)
  if (!found) return null;
  let out = name.replace(re, (species) => table[species]);
  out = out.replace(/\bMega (?=\S)/, 'Méga-');
  // « Alolan Meowth V » → « Miaouss d’Alola V » : la région se place juste après le nom de l'espèce
  const region = out.match(/^(Alolan|Galarian|Hisuian|Paldean) /);
  if (region) {
    const suffix = { Alolan: 'd’Alola', Galarian: 'de Galar', Hisuian: 'de Hisui', Paldean: 'de Paldea' }[region[1]];
    out = out.slice(region[0].length).replace(table[found[0]], `${table[found[0]]} ${suffix}`);
  }
  // « Misty's Psyduck » → « Psykokwak de Misty »
  const owned = out.match(/^(.+?)'s (.+)$/);
  if (owned) out = `${owned[2]} ${owned[1] === 'Team Rocket' ? 'de la' : 'de'} ${owned[1]}`;
  return out;
}

/** Renseigne `fr` sur chaque carte (null si rien à traduire). */
export function applyFrenchNames(catalog, table) {
  for (const card of catalog.cards) card.fr = frenchName(card.en, table);
  return catalog;
}
