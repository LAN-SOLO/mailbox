// Wächter gegen den Rückfrage-Fehler aus 0.1 (S1/L1): Im Tauri-WebView ersetzt
// plugin-dialog 2.7 window.confirm/alert/prompt durch async Stubs, die
// unregistrierte Befehle aufrufen — `if (window.confirm(…))` ist immer wahr,
// alert() zeigt nichts. Rückfragen nur über src/dialog.ts (plugin confirm mit
// await). Läuft mit `pnpm test`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) { fail++; console.log('FAIL', name, extra); } else console.log('ok  ', name);
};
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f)) files.push(p);
  }
};
walk('src');
const hits: string[] = [];
for (const f of files) {
  if (f.endsWith('devmock.ts')) continue; // Browser-Mock, nie im Release
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/`[^`]*`|'[^']*'/g, "''");
    const native = /\bwindow\.(confirm|alert|prompt)\s*\(/.test(code) || /(^|[^.\w])(alert|prompt)\s*\(/.test(code);
    // einzige erlaubte Stelle: der Rückfall in dialog.ts (ohne Plugin → „nein“)
    if (native && !(f.endsWith('dialog.ts') && /Promise\.resolve\(window\.confirm/.test(code))) hits.push(`${f}:${i + 1}: ${line.trim()}`);
  });
}
ok('no native window.confirm/alert/prompt outside dialog.ts', hits.length === 0, '\n' + hits.join('\n'));
const dialog = readFileSync('src/dialog.ts', 'utf8');
ok('dialog.ts awaits plugin confirm', /from '@tauri-apps\/plugin-dialog'/.test(dialog) && /return await confirm\(/.test(dialog));
const caps = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
ok('capability allows dialog message (confirm/ask)', caps.permissions.some((p: string) => p === 'dialog:default' || p === 'dialog:allow-message'));
if (fail) { console.log(fail, 'failures'); process.exit(1); }
