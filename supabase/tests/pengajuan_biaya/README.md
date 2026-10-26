# Uji SQL: pengajuan biaya (20261026000001)

Diuji di Postgres lokal kosong, **bukan** di database produksi:

```bash
createdb t
psql -d t -v ON_ERROR_STOP=1 -f supabase/tests/pengajuan_biaya/stubs.sql
psql -d t -v ON_ERROR_STOP=1 -f supabase/migrations/20261026000001_villa_pengajuan_biaya.sql
psql -d t -f supabase/tests/pengajuan_biaya/behavior.sql   # PASS/FAIL per cek
```

`stubs.sql` hanya meniru `villa_users`, `storage.buckets`, dan peran Supabase
(`anon`, `authenticated`, `service_role`).
