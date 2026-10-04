// Weekly copy of the school's data to Google Drive (`npm run farm -- backup`).
// The database is small (tens of MB) but nothing else keeps a copy of it, so every table the API
// exposes is exported as JSON, gzipped and put into "Резервні копії" on the school's Drive.
// It is a data export, not a pg_dump: the schema lives in supabase/migrations, Vault secrets and
// password hashes are not included, and files in storage buckets are not copied.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { driveAvailable, driveViewUrl, uploadToDrive } from "./drive.ts";
import { SUPABASE_URL, supabase, type FarmSettings } from "./env.ts";

const PAGE = 1000;

export async function backupDatabase(s: FarmSettings, log: (m: string) => void): Promise<void> {
  const sb = supabase();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sb || !key) throw new Error("Потрібен SUPABASE_SERVICE_ROLE_KEY");
  if (!(await driveAvailable())) throw new Error("Google ще не підключено з доступом до Диска: кабінет → Налаштування → Інтеграції → підключити Google ще раз");

  // PostgREST describes itself: the OpenAPI document lists every table and view of the public schema.
  const spec = (await (await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: key, authorization: `Bearer ${key}` } })).json()) as { definitions?: Record<string, unknown> };
  const tables = Object.keys(spec.definitions ?? {}).sort();
  if (!tables.length) throw new Error("PostgREST не повернув перелік таблиць");

  const dump: Record<string, unknown[]> = {};
  for (const table of tables) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select("*").range(from, from + PAGE - 1);
      if (error) {
        log(`  ⚠ ${table}: ${error.message}`);
        break;
      }
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
    dump[table] = rows;
  }
  // Accounts (without password hashes), so rows that point at auth.users can be matched again.
  const users: unknown[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: PAGE });
    if (error || !data.users.length) break;
    users.push(...data.users.map((u) => ({ id: u.id, email: u.email, phone: u.phone, created_at: u.created_at, user_metadata: u.user_metadata })));
    if (data.users.length < PAGE) break;
  }
  dump["auth.users"] = users;

  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(os.tmpdir(), `seal-english-${stamp}.json.gz`);
  fs.writeFileSync(file, gzipSync(JSON.stringify({ exported_at: new Date().toISOString(), tables: dump })));
  try {
    const id = await uploadToDrive(s, file, path.basename(file), "application/gzip", ["Резервні копії"]);
    const rows = Object.values(dump).reduce((a, r) => a + r.length, 0);
    log(`Резервна копія: ${tables.length + 1} таблиць, ${rows} рядків, ${(fs.statSync(file).size / 1024).toFixed(0)} КБ → ${driveViewUrl(id)}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
}
