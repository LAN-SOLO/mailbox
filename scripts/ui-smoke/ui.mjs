// UI-Smoke-Test gegen den Dev-Mock (headless Chrome über CDP, ohne Dependencies).
//   pnpm dev   # in einem zweiten Terminal
//   node scripts/ui-smoke/ui.mjs   (CHROME=/pfad/zu/chrome optional)

import { launch } from './cdp.mjs';
const b = await launch(9335);
const { ev, waitFor, sleep, key } = b;
let fail = 0; const ok = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name, cond ? '' : extra); if (!cond) fail++; };
const click = (sel, text) => ev(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${text ? `els.find(e => e.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) throw new Error('no el ${sel} ${text||''}'); el.click(); return true; })()`);
const setVal = (sel, v) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
const last = (k) => ev(`JSON.stringify(window.${k} ?? null)`).then(JSON.parse);
const text = () => ev('document.body.innerText');

await b.nav('http://localhost:1433/?mock');
await waitFor(`document.querySelector('.hlp-modal')`, 20000);
ok('first-run tutorial shown', true);
await key('Escape');
await waitFor(`!document.querySelector('.hlp-overlay')`);
ok('Esc closes help', true);
await waitFor(`document.querySelectorAll('.msg').length === 3`);
ok('inbox lists 3 mock messages', true);

// Lesen: HTML-Mail, CSP-Meta zuerst
await click('.msg', 'Angebot Q4');
await waitFor(`document.querySelector('.readbody iframe')`);
const srcdoc = await ev(`document.querySelector('.readbody iframe').getAttribute('srcdoc')`);
ok('mail iframe starts with CSP meta', srcdoc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'), srcdoc.slice(0, 120));
ok('remote blocked by default', srcdoc.includes("img-src data:;"));
ok('sandbox without scripts', (await ev(`document.querySelector('.readbody iframe').getAttribute('sandbox')`)) === 'allow-same-origin');
await click('.hintbar button', 'Externe Bilder laden');
await sleep(150);
ok('load remote → img-src https', (await ev(`document.querySelector('.readbody iframe').getAttribute('srcdoc')`)).includes('img-src data: https: http:'));
ok('attachment chip visible', (await text()).includes('Angebot.pdf'));
await click('.attach button', 'Angebot.pdf');
await sleep(200);
ok('attachment save toast', (await text()).includes('Gespeichert'));

// Löschen mit Rückfrage: Abbrechen → nichts, OK → gelöscht
b.setDialog(false);
await click('.readbar button', 'Löschen');
await sleep(300);
ok('delete asks (cancel)', b.dialogs.length === 1 && (await last('__lastDelete')) === null, JSON.stringify(b.dialogs));
ok('message still listed after cancel', (await ev(`document.querySelectorAll('.msg').length`)) === 3);
b.setDialog(true);
await click('.readbar button', 'Löschen');
await sleep(300);
ok('delete after OK', (await last('__lastDelete'))?.uids?.[0] === 3);
ok('removed from list', (await ev(`document.querySelectorAll('.msg').length`)) === 2);

// Antworten (einfacher Modus) → Senden: inReplyTo + answered auf Quelle
await click('.msg', 'Terminvorschlag');
await waitFor(`document.querySelector('.readhead h1')?.textContent.includes('Terminvorschlag')`);
await sleep(150);
await click('.readbar button', 'Antworten');
await waitFor(`document.querySelector('.modal.compose')`);
ok('reply subject', (await ev(`document.querySelector('.modal.compose input[type=text]:nth-of-type(1)') && [...document.querySelectorAll('.modal.compose input')].some(i => i.value === 'Re: Terminvorschlag')`)));
// andere Nachricht öffnen, während der Editor offen ist, geht nicht (Overlay) — Flag-Quelle prüfen wir über das Mock
await click('.modal.compose button.primary', 'Senden');
await sleep(300);
const sent = await last('__lastDraft');
ok('reply draft inReplyTo', sent?.inReplyTo === '<msg-2@lan-solo.test>', JSON.stringify(sent));
ok('simple mode sends plain text only', sent?.html === null && sent?.priority === 'normal');

// Weiterleiten mit Anhang (Nachricht 3 ist gelöscht → nachladen über Abrufen)
await click('.header button', 'Abrufen');
await waitFor(`document.querySelectorAll('.msg').length === 3`);
await click('.msg', 'Angebot Q4');
await waitFor(`document.querySelector('.attach')`);
await click('.readbar button', 'Weiterleiten');
await waitFor(`document.querySelector('.modal.compose')`);
ok('forward shows original attachment', (await ev(`document.querySelector('.attachlist')?.innerText ?? ''`)).includes('Angebot.pdf'));
await setVal('.modal.compose label.field:nth-of-type(2) input', 'anna@lan-solo.test');
await click('.modal.compose button.primary', 'Senden');
await sleep(300);
let d = await last('__lastDraft');
ok('forward sends serverAttachments', JSON.stringify(d?.serverAttachments) === JSON.stringify({ accountId: 'a1', folder: 'INBOX', uid: 3, indices: [2] }), JSON.stringify(d?.serverAttachments));

// Experte
await click('.header .seg button', 'Experte');
await sleep(200);
// Editor: Esc mit Änderungen fragt nach
await key('n', { text: 'n' });
await waitFor(`document.querySelector('.modal.compose')`);
const toVal = await ev(`document.querySelector('.modal.compose label.field:nth-of-type(2) input').value`);
ok('n shortcut opens compose without typing n', toVal === '', JSON.stringify(toVal));
await setVal('.modal.compose textarea', 'Wichtiger Text');
b.setDialog(false); const before = b.dialogs.length;
await ev(`document.activeElement?.blur(); true`);
await key('Escape');
await sleep(300);
ok('Esc on dirty compose asks', b.dialogs.length === before + 1);
ok('compose stays after cancel', await ev(`!!document.querySelector('.modal.compose')`));
b.setDialog(true);
await key('Escape');
await sleep(300);
ok('compose closes after OK', !(await ev(`!!document.querySelector('.modal.compose')`)));

// Entwurf fortsetzen
await click('.sb-folder', 'Entwürfe');
await waitFor(`document.querySelectorAll('.msg').length === 1`);
await click('.msg', 'Angebot nachfassen');
await waitFor(`[...document.querySelectorAll('.readbar button')].some(b => b.textContent.includes('Weiter bearbeiten') && !b.disabled)`);
await click('.readbar button', 'Weiter bearbeiten');
await waitFor(`document.querySelector('.modal.compose')`);
ok('draft compose title', (await ev(`document.querySelector('.modal.compose h2').textContent`)) === 'Entwurf');
ok('draft body restored', (await ev(`document.querySelector('.modal.compose textarea').value`)).includes('kurze Nachfrage'));
await click('.modal.compose button', 'Als Entwurf speichern');
await sleep(300);
d = await last('__lastDraft');
ok('draft save replaces old', JSON.stringify(d?.replacesDraft) === JSON.stringify({ accountId: 'a1', folder: 'Drafts', uid: 10 }) && d?.serverAttachments?.indices?.[0] === 1, JSON.stringify(d));
ok('draft keeps to', d?.to === 'Anna Beispiel <anna@lan-solo.test>');

// Einstellungen → Konten → Bearbeiten: Konto-Dialog liegt oben, Esc schließt nur ihn
await click('.header button.icon');
await waitFor(`document.querySelector('.modal.settings')`);
await click('.set-tabs button', 'Konten');
await click('.acct-row button.icon');
await waitFor(`document.querySelector('.modal.wide')`);
const top = await ev(`(() => { const m = document.querySelector('.modal.wide').getBoundingClientRect(); return document.elementFromPoint(m.left + m.width/2, m.top + 20)?.closest('.modal')?.className; })()`);
ok('account modal is on top of settings', top?.includes('wide'), top);
ok('plain-text warning for security=none', (await text()).includes('Klartext übers Netz'));
await setVal('.modal.wide input[type=number]', '0');
await click('.modal.wide button.primary', 'Speichern');
await sleep(150);
ok('port 0 rejected', (await ev(`document.querySelector('.modal.wide .errline')?.textContent ?? ''`)).includes('65535'));
await key('Escape');
await sleep(150);
ok('Esc closes only account modal', !(await ev(`!!document.querySelector('.modal.wide')`)) && (await ev(`!!document.querySelector('.modal.settings')`)));
await click('.set-tabs button', 'App');
await sleep(150);
ok('version from runtime', (await ev(`document.querySelector('.updatebox').innerText`)).includes('1.0.0'));
// Live-Vorschau zurücknehmen
await click('.set-tabs button', 'Allgemein');
await setVal('.modal.settings select:nth-of-type(1)', 'en');
await ev(`(() => { const sels = [...document.querySelectorAll('.modal.settings select')]; const th = sels.find(s => [...s.options].some(o => o.value === 'light')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(th, 'light'); th.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await sleep(150);
ok('light theme live', (await ev(`document.documentElement.getAttribute('data-theme')`)) === 'light');
await key('Escape');
await sleep(200);
ok('Esc in settings reverts live preview', (await ev(`document.documentElement.getAttribute('data-theme')`)) === 'dark' && (await text()).includes('Neue Nachricht'));

// Englisch speichern
await click('.header button.icon');
await waitFor(`document.querySelector('.modal.settings')`);
await ev(`(() => { const s = document.querySelector('.modal.settings select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'en'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await click('.modal.settings button.primary');
await sleep(200);
ok('EN UI', (await text()).includes('New message') && (await text()).includes('Drafts'));

// Sammel-Posteingang Sortierung
await click('.sb-folder', 'All inboxes');
await waitFor(`document.querySelectorAll('.msg').length >= 4`);
const subs = await ev(`[...document.querySelectorAll('.msg .l2')].map(e => e.textContent)`);
ok('unified inbox sorted newest first', subs[0].startsWith('Angebot Q4'), JSON.stringify(subs));

// mailto im HTML-Iframe → Editor
await click('.msg', 'Angebot Q4');
await waitFor(`document.querySelector('.readbody iframe')?.contentDocument?.body`);
await ev(`(() => { const d = document.querySelector('.readbody iframe').contentDocument; const a = d.createElement('a'); a.href = 'mailto:info@lan-solo.test?subject=Hallo%20Welt'; a.textContent = 'x'; d.body.appendChild(a); a.click(); return true; })()`);
await sleep(200);
ok('mailto opens compose', (await ev(`[...document.querySelectorAll('.modal.compose input')].map(i => i.value).join('|')`)).includes('info@lan-solo.test|') );
ok('mailto subject', (await ev(`[...document.querySelectorAll('.modal.compose input')].some(i => i.value === 'Hallo Welt')`)));
await key('Escape'); await sleep(200);
await ev(`(() => { const d = document.querySelector('.readbody iframe').contentDocument; const a = d.createElement('a'); a.href = 'https://lan-solo.com/x'; a.innerHTML = '<span id=sp>y</span>'; d.body.appendChild(a); d.getElementById('sp').click(); return true; })()`);
await sleep(200);
ok('https link (nested element) opens externally', (await last('__lastOpened')) === 'https://lan-solo.com/x');

console.log('console errors:', b.logs.filter(l => !/favicon/.test(l)));
console.log(fail ? `${fail} FAILURES` : 'ALL OK');
b.close();
process.exit(fail ? 1 : 0);
