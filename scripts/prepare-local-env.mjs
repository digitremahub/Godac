import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const sourcePath = resolve(root, ".env.production");
const localPath = resolve(root, ".env.local");
const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const defaults = { NEXT_PUBLIC_APP_URL: "http://localhost:3000" };

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\\r?\\n/)) {
    const match = line.match(/^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*?)\\s*$/);
    if (match) values.set(match[1], match[2].replace(/^(['"])(.*)\\1$/, "$2"));
  }
  return values;
}

let productionText;
try {
  productionText = await readFile(sourcePath, "utf8");
} catch {
  console.error("GODAC : .env.production est introuvable. Impossible de préparer les variables Supabase locales.");
  process.exit(1);
}

const production = parseEnv(productionText);
for (const key of required) {
  if (!production.get(key)) {
    console.error(`GODAC : ${key} est absent de .env.production.`);
    process.exit(1);
  }
}

let localText = "";
try {
  localText = await readFile(localPath, "utf8");
} catch {
  // .env.local will be created below.
}
const local = parseEnv(localText);
const additions = [];
for (const key of required) {
  if (!local.get(key) && production.get(key)) additions.push(`${key}=${production.get(key)}`);
}
if (!local.get("NEXT_PUBLIC_APP_URL")) additions.push(`NEXT_PUBLIC_APP_URL=${defaults.NEXT_PUBLIC_APP_URL}`);

if (additions.length) {
  const separator = localText.length && !localText.endsWith("\\n") ? "\\n" : "";
  await writeFile(localPath, localText + separator + (localText.trim() ? "\\n" : "") + additions.join("\\n") + "\\n", "utf8");
  console.log("GODAC : variables publiques Supabase locales préparées dans .env.local (les valeurs locales déjà définies sont conservées).");
} else {
  console.log("GODAC : variables Supabase locales déjà configurées.");
}
