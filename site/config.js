// Réglages du site. Aucune donnée personnelle ici : ce fichier est public.

// Où sont publiés catalog.json, snapshot.json et history/.
export const DATA_URL = './data';

// Projet Supabase qui garde la collection et les envies (clé « publishable », faite pour être publique ;
// les données sont protégées par la connexion et les règles d'accès de la base).
export const SUPABASE_URL = 'https://nwxocmjgqdaawwhyzgon.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_u-WQDOefcddTj8n35khSsw_18AbLxFy';

// Filtres appliqués aux offres quand on ouvre une fiche Cardmarket.
// language : 7 = japonais. sellerCountry : 12 = France. Retirer une ligne pour lever le filtre.
export const CARDMARKET_FILTERS = { language: 7, sellerCountry: 12 };

// Clé publique des notifications (VAPID). La clé privée correspondante est le secret GitHub VAPID_PRIVATE_KEY.
export const VAPID_PUBLIC_KEY = 'BNvhCX4QzboupHDHlLXxWuk3RukrlEW6fUaWLZe3Zkw-VpX9oQV5aZ0ktIG1oeYWcFUElcTq-w83yfQ_zLt5cl8';
