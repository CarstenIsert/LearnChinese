import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_FILES = [
  /^\.env($|\.)(?!example$)/,
  /\.db($|-wal$|-shm$)/,
  /\.sqlite3?$/,
  /profile\.local\.json$/,
  /\.(pem|key|p12)$/,
];

const SECRET_PATTERNS = [
  { name: 'Google API key (AIza...)', regex: /AIza[0-9A-Za-z_-]{35}/g },
  { name: 'OpenAI/generic sk- key', regex: /\bsk-[A-Za-z0-9_-]{24,}\b/g },
  { name: 'Private key header', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    name: 'Hardcoded GEMINI_API_KEY assignment',
    regex: /GEMINI_API_KEY\s*=\s*(?!your_gemini_api_key_here\b)[A-Za-z0-9_-]{20,}/g,
  },
];

let hasError = false;

const trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean);

for (const file of trackedFiles) {
  if (file === 'scripts/check-secrets.mjs') continue;

  for (const pattern of FORBIDDEN_FILES) {
    if (pattern.test(path.basename(file)) || pattern.test(file)) {
      console.error(`[FAIL] Forbidden tracked file: ${file}`);
      hasError = true;
    }
  }

  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const { name, regex } of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(content)) {
      console.error(`[FAIL] ${name} detected in tracked file: ${file}`);
      hasError = true;
    }
  }
}

const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(js|css|html|map)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        if (
          /AIza[0-9A-Za-z_-]{35}/.test(text) ||
          /\bsk-[A-Za-z0-9_-]{24,}\b/.test(text) ||
          /GEMINI_API_KEY\s*[:=]\s*["']?(?!fehlt|wurde|missing|your_)[A-Za-z0-9_-]{20,}/.test(text)
        ) {
          console.error(`[FAIL] Potential API key detected in build output: ${full}`);
          hasError = true;
        }
      }
    }
  };
  walk(distDir);
}

if (hasError) {
  process.exit(1);
}

console.log(`Secret check passed (${trackedFiles.length} tracked files${fs.existsSync(distDir) ? ' + dist/' : ''} scanned).`);
