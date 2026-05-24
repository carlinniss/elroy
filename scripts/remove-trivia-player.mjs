import { readFileSync } from 'fs';

for (const line of readFileSync('.env.production.local', 'utf8').split('\n')) {
  const index = line.indexOf('=');
  if (index <= 0) continue;
  const key = line.slice(0, index);
  let value = line.slice(index + 1);
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  process.env[key] = value;
}

const login = process.argv[2]?.trim().toLowerCase();
if (!login) {
  console.error('Usage: node scripts/remove-trivia-player.mjs <username>');
  process.exit(1);
}

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
if (!url || !token) {
  console.error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  process.exit(1);
}

async function cmd(command) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result ?? null;
}

const pipelineUrl = `${url.replace(/\/$/, '')}/pipeline`;

async function pipeline(commands) {
  const res = await fetch(pipelineUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(commands),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

const before = {
  cannabis: await cmd(['ZSCORE', 'elroy:trivia:scores:cannabis', login]),
  freaky: await cmd(['ZSCORE', 'elroy:trivia:scores:freaky', login]),
};

await pipeline([
  ['ZREM', 'elroy:trivia:scores:cannabis', login],
  ['ZREM', 'elroy:trivia:scores:freaky', login],
  ['HDEL', 'elroy:trivia:display-names', login],
]);

const after = {
  cannabis: await cmd(['ZSCORE', 'elroy:trivia:scores:cannabis', login]),
  freaky: await cmd(['ZSCORE', 'elroy:trivia:scores:freaky', login]),
};

console.log(JSON.stringify({ username: login, before, after }, null, 2));
