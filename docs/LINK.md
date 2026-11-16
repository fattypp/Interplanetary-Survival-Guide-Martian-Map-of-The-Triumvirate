# Mars base <-> Earth control link

Two pages share SOS messages through `web/js/link.js` (`window.JdaLink`):

- Mars base: `dist/jezero-delta-atlas.html` (press SOS, enter a name or callsign, Send).
- Earth control: `dist/earth-control.html` (shows "<name> pressed SOS", has an Acknowledge button; Mars shows a toast back).

Everything is a simulation. No real signal is sent.

## Modes
- **same-browser** (default, no setup): works between two tabs of one browser on the same site. It does not cross devices.
- **online**: fill in `web/data/link-config.js` (`url`, `key`, `table`) to also store messages in a Supabase table, which lets two different devices talk. Rebuild dist afterwards.

```sql
create table link_messages (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table link_messages enable row level security;
create policy "anon read"   on link_messages for select to anon using (true);
create policy "anon insert" on link_messages for insert to anon with check (true);
```
Use only the public anon key. Never put a service key in the repo. The anon policies above let anyone with the site read and write this table, so keep it for demo data only.
