// Layout- und Sprach-Durchlauf (headless Chrome gegen `pnpm dev`, Dev-Mock):
// DE/EN × dunkel/hell bei Mindestgröße 900×580 (tauri.conf.json) — prüft
// Überlauf, abgeschnittene Knöpfe, Dialoge außerhalb des Fensters und
// Texte der jeweils anderen Sprache; dazu Fehleranzeigen (Update, Liste).
//   pnpm dev   # zweites Terminal
//   node --experimental-strip-types scripts/ui-smoke/sweep.mjs   (SHOTS=/ordner für Screenshots)
import { launch } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
const { dicts } = await import('../../src/i18n.ts');
const b = await launch(9336);
const { ev, waitFor, sleep, key, send } = b;
let fail = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name, cond ? '' : extra); if (!cond) fail++; };
const click = (sel, text) => ev(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${text ? `els.find(e => e.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) throw new Error('no el ${sel} ${text || ''}'); el.click(); return true; })()`);
const W = 900, H = 580;
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// Texte, die es nur in einer Sprache gibt (≥ 6 Zeichen, ohne Kürzel/Platzhalter)
const only = (a, o) => [...new Set(Object.entries(dicts[a]).filter(([k, v]) => typeof v === 'string' && v.length >= 6 && v !== dicts[o][k] && !/^[\s\W\d]+$/.test(v)).map(([, v]) => v))];
const foreign = { de: only('en', 'de'), en: only('de', 'en') };

const LAYOUT = `(() => {
  const out = []; const vw = innerWidth, vh = innerHeight;
  const se = document.scrollingElement;
  if (se.scrollWidth > vw + 1) out.push('page scrolls horizontally: ' + se.scrollWidth);
  for (const el of document.querySelectorAll('button, .modal, .toast, .upd-banner, .hlp-modal, .ctxmenu, select, input, h1, h2')) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    // nur Elemente prüfen, die nicht in einem scrollbaren Container liegen
    let p = el.parentElement, scrolled = false;
    while (p) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) { scrolled = true; break; } p = p.parentElement; }
    const id = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ' "' + (el.textContent || el.value || '').trim().slice(0, 30) + '"';
    if (!scrolled && (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1)) out.push('outside window: ' + id + ' ' + JSON.stringify([Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]));
    if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') out.push('clipped button: ' + id);
  }
  // alle Eingabefelder wie das Textfeld gestaltet (Passwort war ungestylt weiß)
  const ref = document.querySelector('input[type=text]');
  if (ref) for (const i of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=file])')) {
    if (!i.offsetParent) continue;
    if (getComputedStyle(i).backgroundColor !== getComputedStyle(ref).backgroundColor) out.push('unstyled input: type=' + i.type);
  }
  return out;
})()`;
const textOf = `(() => { const parts = [document.body.innerText]; document.querySelectorAll('[title]:not(.sb-folder)').forEach(e => parts.push(e.getAttribute('title'))); document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(e => parts.push(e.placeholder)); return parts.join('\\n'); })()`;

async function check(label, lang) {
  const issues = await ev(LAYOUT);
  ok(`${label}: layout`, issues.length === 0, '\n   ' + issues.join('\n   '));
  const txt = await ev(textOf);
  // ganze Wörter (ein „Expert“ steckt in „Experte“); Ordner-Tooltips zeigen Servernamen
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wrong = foreign[lang].filter((s) => new RegExp(`(?<!\\p{L})${esc(s)}(?!\\p{L})`, 'u').test(txt));
  ok(`${label}: no ${lang === 'de' ? 'EN' : 'DE'} UI strings`, wrong.length === 0, JSON.stringify(wrong));
  if (process.env.SHOTS) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${process.env.SHOTS}/${label.replace(/[^\w-]+/g, '_')}.png`, Buffer.from(data, 'base64'));
  }
}

for (const lang of ['de', 'en']) for (const theme of ['dark', 'light']) {
  const t = dicts[lang]; const L = `${lang}/${theme}`;
  await b.nav(`http://localhost:1433/?mock&lang=${lang}&theme=${theme}&mode=expert&update`);
  await ev(`localStorage.removeItem('mailbox.tutorialSeen'); true`).catch(() => {});
  await b.nav(`http://localhost:1433/?mock&lang=${lang}&theme=${theme}&mode=expert&update`);
  await waitFor(`document.querySelector('.hlp-modal')`, 20000);
  ok(`${L}: theme applied`, (await ev(`document.documentElement.getAttribute('data-theme')`)) === theme);
  await check(`${L} help`, lang);
  await key('Escape');
  await waitFor(`document.querySelectorAll('.msg').length === 3`);
  await check(`${L} main`, lang);
  await click('.msg', 'Angebot Q4');
  await waitFor(`document.querySelector('.readbody iframe')`);
  await sleep(200);
  await check(`${L} read html`, lang);
  await key('n', { text: 'n' });
  await waitFor(`document.querySelector('.modal.compose')`);
  await check(`${L} compose expert`, lang);
  ok(`${L}: no update banner over compose`, !(await ev(`!!document.querySelector('.upd-banner')`)));
  b.setDialog(true); await key('Escape'); await sleep(200);
  for (const tab of [t.setGeneral, t.setReading, t.setCompose, t.setAccounts, t.setApp]) {
    if (!(await ev(`!!document.querySelector('.modal.settings')`))) { await click('.header button.icon'); await waitFor(`document.querySelector('.modal.settings')`); }
    await click('.set-tabs button', tab); await sleep(120);
    await check(`${L} settings ${tab}`, lang);
  }
  // Update-Fehler in der App-Sprache sichtbar (vorher stumm)
  const updMsg = lang === 'de' ? 'Update-Prüfung fehlgeschlagen: Netzwerk nicht erreichbar' : 'Update check failed: network unreachable';
  await ev(`window.__mockFail = { check_update: ${JSON.stringify(updMsg)} }; true`);
  await click('.updatebox button', t.checkUpdates); await sleep(250);
  ok(`${L}: update check error shown`, (await ev(`document.querySelector('.updatebox').innerText`)).includes(updMsg));
  await check(`${L} settings update error`, lang);
  await ev(`window.__mockFail = { install_update: ${JSON.stringify(lang === 'de' ? 'Update fehlgeschlagen: Signatur ungültig' : 'Update failed: invalid signature')} }; true`);
  await click('.updatebox button', t.checkUpdates); await sleep(250);
  await click('.updatebox button.primary', t.installUpdate); await sleep(250);
  ok(`${L}: install error shown, button usable again`, (await ev(`document.querySelector('.updatebox').innerText`)).includes(lang === 'de' ? 'Signatur ungültig' : 'invalid signature') && !(await ev(`document.querySelector('.updatebox button.primary')?.disabled ?? false`)));
  await ev(`window.__mockFail = {}; true`);
  await key('Escape'); await sleep(150);
  // Update-Banner beim Start: Fehler beim Installieren als Meldung
  ok(`${L}: update banner`, await ev(`!!document.querySelector('.upd-banner')`));
  // verdeckt keine Bedienelemente der Kopfzeile
  ok(`${L}: banner leaves header free`, await ev(`(() => { const r = document.querySelector('.upd-banner').getBoundingClientRect(); return [...document.querySelectorAll('.header button, .header input')].every(e => { const q = e.getBoundingClientRect(); return q.bottom <= r.top || q.top >= r.bottom || q.right <= r.left || q.left >= r.right; }); })()`));
  await check(`${L} update banner`, lang);
  await ev(`window.__mockFail = { install_update: 'X-FAIL' }; true`);
  await click('.upd-banner button.primary'); await sleep(250);
  ok(`${L}: banner install error toast`, (await ev(`document.querySelector('.toast')?.innerText ?? ''`)).includes('X-FAIL'));
  await ev(`window.__mockFail = {}; true`);
  // Konto-Dialog
  await click('.header button.icon'); await waitFor(`document.querySelector('.modal.settings')`);
  await click('.set-tabs button', t.setAccounts); await sleep(100);
  await click('.acct-row button.icon'); await waitFor(`document.querySelector('.modal.wide')`);
  await check(`${L} account dialog`, lang);
  await key('Escape'); await sleep(100); await key('Escape'); await sleep(150);
  // Lange Fehlermeldung als Toast passt ins Fenster
  await ev(`window.__mockFail = { list_messages: ${JSON.stringify('IMAP imap.sehr-langer-servername.example.org:993 — ' + (lang === 'de' ? 'Zeitüberschreitung — der Server antwortet nicht (100 s)' : 'Timeout — the server does not respond (100 s)') + ' ' + 'x'.repeat(120))} }; true`);
  await click('.header button', t.refresh ?? ''); await sleep(300);
  ok(`${L}: list error toast`, await ev(`!!document.querySelector('.toast')`));
  await check(`${L} long error toast`, lang);
  await ev(`window.__mockFail = {}; true`);
  // Rechtsklick Ordner (Experte) → native Rückfrage; Abbrechen löscht nichts
  b.setDialog(false); const nd = b.dialogs.length;
  await ev(`window.__lastDeleteFolder = null; (() => { const f = [...document.querySelectorAll('.sb-folder')].find(e => e.textContent.includes('Newsletter')); f.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 150, clientY: 500 })); return true; })()`);
  await sleep(300);
  ok(`${L}: delete folder asks in UI language, cancel keeps it`, b.dialogs.length === nd + 1 && b.dialogs[nd].includes('Newsletter') && (await ev(`window.__lastDeleteFolder`)) === null, JSON.stringify(b.dialogs.slice(nd)));
  b.setDialog(true);
}

// Schnelles Weiterklicken: die zuletzt geklickte Nachricht bleibt stehen
await b.nav(`http://localhost:1433/?mock`);
await ev(`localStorage.setItem('mailbox.tutorialSeen', '1'); true`);
await b.nav(`http://localhost:1433/?mock`);
await waitFor(`document.querySelectorAll('.msg').length === 3`, 20000);
await key('Escape'); await sleep(100);
await click('.msg', 'Angebot Q4'); await click('.msg', 'Willkommen'); await sleep(500);
ok('fast clicking shows the last message', (await ev(`document.querySelector('.readhead h1')?.textContent ?? ''`)).includes('Willkommen'));
// Verifikation Runde 2: die ältere Antwort kommt *später* (langsamer Server) —
// sie darf weder die zuletzt geklickte Nachricht noch die Ansicht nach einem
// Ordnerwechsel überschreiben.
const h1 = () => ev(`document.querySelector('.readhead h1')?.textContent ?? ''`);
await ev(`window.__mockDelay = { get_message: (a) => (a.uid === 3 ? 700 : 60) }; true`);
await click('.msg', 'Re: Terminvorschlag'); await sleep(300);
await click('.msg', 'Angebot Q4'); await click('.msg', 'Willkommen'); await sleep(1000);
ok('slow older reply does not replace the last clicked message', (await h1()).includes('Willkommen'), await h1());
// … und nach einem Ordnerwechsel die verlassene Nachricht nicht still als gelesen markieren
await ev(`(() => { const T = window.__TAURI_INTERNALS__; if (!T.__orig) { T.__orig = T.invoke; T.invoke = (c, a) => { if (c === 'set_flag') (window.__flagCalls ??= []).push(a); return T.__orig(c, a); }; } window.__flagCalls = []; return true; })()`);
await click('.msg', 'Angebot Q4'); await sleep(100);
await click('.sb-folder', 'Entw'); await sleep(1000);
ok('slow reply after a folder switch marks nothing read', (await ev(`window.__flagCalls.length`)) === 0, JSON.stringify(await ev(`window.__flagCalls`)));
await ev(`window.__mockDelay = {}; true`);

console.log('console errors:', b.logs.filter((l) => !/favicon|X-FAIL|fehlgeschlagen|failed|Timeout|Zeitüberschreitung/.test(l)));
console.log(fail ? `${fail} FAILURES` : 'ALL OK');
b.close();
process.exit(fail ? 1 : 0);
