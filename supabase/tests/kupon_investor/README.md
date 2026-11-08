# Uji SQL: kupon diskon investor (20261108000001)

Diuji di Postgres lokal kosong, **bukan** di database produksi:

```bash
createdb t
psql -d t -v ON_ERROR_STOP=1 -f supabase/tests/kupon_investor/stubs.sql
psql -d t -v ON_ERROR_STOP=1 -f supabase/migrations/20261108000001_kupon_investor_el.sql
psql -d t -f supabase/tests/kupon_investor/behavior.sql   # PASS/FAIL per cek
```
