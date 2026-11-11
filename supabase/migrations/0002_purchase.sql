-- Prix et date d'achat des cartes possédées, facultatifs.
-- paid_cents : prix payé par exemplaire, en centimes (moyenne si plusieurs exemplaires).
alter table public.holdings
  add column if not exists paid_cents integer check (paid_cents >= 0),
  add column if not exists bought_on  date;
