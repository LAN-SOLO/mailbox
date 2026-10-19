// Nutzer-Abläufe von Erststart bis Expertenfunktionen, inkl. Fehlerfällen
// (Datei-Dialog abgebrochen, Platte voll, schreibgeschützter Ordner,
// gesperrte Datei, Zeitüberschreitung, Neustart mitten im Schreiben) —
// je Durchlauf DE (macOS-Kürzel ⌘) und EN (Windows-Kürzel Strg über
// navigator.platform = Win32). Headless Chrome gegen `pnpm dev`, Dev-Mock.
//   pnpm dev   # zweites Terminal
//   node --experimental-strip-types scripts/ui-smoke/journeys.mjs
import { launch } from './cdp.mjs';
const { dicts } = await import('../../src/i18n.ts');

let fail = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name, cond ? '' : extra); if (!cond) fail++; };

const META = 4, CTRL = 2, SHIFT = 8;

async function run(lang, platform) {
  const t = dicts[lang];
  const mod = platform === 'Win32' ? CTRL : META;
  const b = await launch(lang === 'de' ? 9341 : 9342);
  const { ev, waitFor, sleep, key, send } = b;
  if (platform === 'Win32') {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });` });
  }
  const P = `[${lang}/${platform}] `;
  const click = (sel, text) => ev(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${text ? `els.find(e => e.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) throw new Error('no el ${sel} ${text || ''}'); el.click(); return true; })()`);
  const setVal = (sel, v) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
  const last = (k) => ev(`JSON.stringify(window.${k} ?? null)`).then(JSON.parse);
  const clear = (k) => ev(`(window.${k} = undefined, true)`);
  const text = () => ev('document.body.innerText');
  const toast = () => ev(`document.querySelector('.toast')?.innerText ?? ''`);
  const chord = (k, code, vk, extra = 0) => key(k, { code, vk, modifiers: mod | extra });
  const url = `http://localhost:1433/?mock&lang=${lang}`;

  // J1 Erststart: Tutorial durchklicken, nach Neustart nicht erneut
  await b.nav(url);
  await waitFor(`document.querySelector('.hlp-modal')`, 20000);
  let steps = 0;
  while (steps < 12 && (await ev(`!!document.querySelector('.hlp-overlay')`))) {
    await ev(`(() => { const bs = [...document.querySelectorAll('.hlp-modal button')]; const b = bs.find(x => x.textContent.trim() === ${JSON.stringify(lang === 'de' ? 'Weiter' : 'Next')}) || bs.find(x => x.textContent.includes(${JSON.stringify(lang === 'de' ? 'Los geht' : 'Let')})); b.click(); return true; })()`);
    await sleep(80);
    steps++;
  }
  ok(P + 'J1 tutorial walks through to the end', steps === 6, `steps=${steps}`);
  await b.nav(url);
  await waitFor(`document.querySelectorAll('.msg').length === 3`, 20000);
  await sleep(300);
  ok(P + 'J1 tutorial not shown again after restart', !(await ev(`!!document.querySelector('.hlp-overlay')`)));

  // J2 Konto anlegen: Vorschlag beim Verlassen des Adressfelds, Verbindungstest
  await click('.sb-actions button', t.addAccount);
  await waitFor(`document.querySelector('.modal.wide')`);
  const emailSel = `[...document.querySelectorAll('.modal.wide input[type=text]')][1]`;
  await ev(`(() => { const i = ${emailSel}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'neu@example.org'); i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); i.blur(); return true; })()`);
  await sleep(250);
  await click('.modal.wide button', t.accShowServers);
  await sleep(100);
  const hosts = await ev(`[...document.querySelectorAll('.modal.wide input')].map(i => i.value).join('|')`);
  ok(P + 'J2 servers suggested on blur', hosts.includes('imap.example.org') && hosts.includes('smtp.example.org'), hosts);
  await click('.modal.wide button', t.accTest);
  await sleep(300);
  ok(P + 'J2 connection test reports IMAP and SMTP', (await text()).includes('imap.example.org:993') && (await text()).includes('smtp.example.org:587'));
  await key('Escape');
  await sleep(200);
  ok(P + 'J2 Esc closes account dialog', !(await ev(`!!document.querySelector('.modal.wide')`)));

  // J3 Anhang speichern: abgebrochen, Platte voll, schreibgeschützt, gesperrt, Erfolg
  await click('.msg', 'Angebot Q4');
  await waitFor(`document.querySelector('.attach button')`);
  await ev(`(window.__mockDialogCancel = true, window.__lastSaveAttachment = undefined, true)`);
  await click('.attach button', 'Angebot.pdf');
  await sleep(250);
  ok(P + 'J3 cancelled save dialog writes nothing, no toast', (await last('__lastSaveAttachment')) === null && (await toast()) === '', await toast());
  await ev(`(window.__mockDialogCancel = false, true)`);
  const errs = {
    'disk full': 'Speichern fehlgeschlagen: No space left on device (os error 28)',
    'read-only folder': 'Speichern fehlgeschlagen: Permission denied (os error 13)',
    'locked file': 'Speichern fehlgeschlagen — die Datei ist vermutlich in einem anderen Programm geöffnet: (os error 32)',
  };
  for (const [name, msg] of Object.entries(errs)) {
    await ev(`(window.__mockFail = { save_attachment: ${JSON.stringify(msg)} }, true)`);
    await click('.attach button', 'Angebot.pdf');
    await waitFor(`(document.querySelector('.toast')?.innerText ?? '').includes(${JSON.stringify(msg)})`);
    ok(P + `J3 ${name} → error shown`, (await toast()).includes(msg), await toast());
    await ev(`(window.__mockFail = undefined, true)`);
    await sleep(100);
  }
  await click('.attach button', 'Angebot.pdf');
  await sleep(250);
  ok(P + 'J3 save after errors works', (await last('__lastSaveAttachment'))?.path === '/Users/mock/Downloads/Angebot.pdf');

  // J4 Schreiben (einfach): Anhang-Dialog abbrechen / wählen, ⌘/Strg+⏎ aus dem Betreff
  await click('.header button', t.newMessage);
  await waitFor(`document.querySelector('.modal.compose')`);
  ok(P + 'J4 signature already below the text', (await ev(`document.querySelector('.modal.compose textarea').value`)).includes('-- \nMax Muster'));
  await ev(`(window.__mockDialogCancel = true, true)`);
  await click('.modal.compose button', t.attach);
  await sleep(200);
  ok(P + 'J4 cancelled attach dialog adds nothing', !(await ev(`(document.querySelector('.modal.compose .attachlist')?.innerText ?? '').includes('Bericht.pdf')`)));
  await ev(`(window.__mockDialogCancel = false, true)`);
  await click('.modal.compose button', t.attach);
  await sleep(200);
  ok(P + 'J4 picked attachment listed', (await ev(`document.querySelector('.modal.compose')?.innerText ?? ''`)).includes('Bericht.pdf'));
  await setVal('.modal.compose label.field:nth-of-type(2) input', 'anna@lan-solo.test');
  const subjSel = `[...document.querySelectorAll('.modal.compose label.field')].find(l => l.textContent.startsWith(${JSON.stringify(t.subject)}))?.querySelector('input')`;
  await ev(`(() => { const i = ${subjSel}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Bericht'); i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); return true; })()`);
  await clear('__lastDraft');
  await chord('Enter', 'Enter', 13);
  await sleep(300);
  const sentJ4 = await last('__lastDraft');
  ok(P + 'J4 mod+Enter from the subject field sends', sentJ4?.subject === 'Bericht' && sentJ4?.attachments?.[0] === '/Users/mock/Documents/Bericht.pdf', JSON.stringify(sentJ4));
  ok(P + 'J4 editor closed after send', !(await ev(`!!document.querySelector('.modal.compose')`)));

  // J5 Zeitüberschreitung beim Abrufen, danach erholt
  await ev(`(window.__mockFail = { list_messages: ${JSON.stringify(lang === 'de' ? 'Zeitüberschreitung — der Server antwortet nicht (100 s)' : 'Timeout — the server does not respond (100 s)')} }, true)`);
  await click('.header button', t.refresh);
  await waitFor(`(document.querySelector('.toast')?.innerText ?? '').includes('100 s')`);
  ok(P + 'J5 timeout shown in app language', (await toast()).includes(lang === 'de' ? 'Zeitüberschreitung' : 'Timeout'));
  await ev(`(window.__mockFail = undefined, true)`);
  await click('.header button', t.refresh);
  await waitFor(`document.querySelectorAll('.msg').length === 3`);
  ok(P + 'J5 refresh after timeout lists again', true);

  // J6 Experte: Editor-Kürzel (Vorschau hin und zurück, Entwurf aus „An“), Umbruch 72
  await click('.header .seg button', t.modeExpert);
  await sleep(200);
  await key('n', { text: 'n' });
  await waitFor(`document.querySelector('.modal.compose textarea')`);
  const sig = 'Max Muster · Beispiel GmbH · Musterstraße 1 · 12345 Musterstadt · Tel. +49 000 000000';
  await setVal('.modal.compose textarea', `${'wort '.repeat(30).trim()}\n\n-- \n${sig}`);
  await click('.modal.compose button', t.toolWrap);
  await sleep(100);
  const wrapped = await ev(`document.querySelector('.modal.compose textarea').value`);
  ok(P + 'J6 wrap 72 keeps the signature line', wrapped.endsWith(sig) && wrapped.split('\n')[0].length <= 72, JSON.stringify(wrapped));
  await ev(`document.querySelector('.modal.compose textarea').focus(); true`);
  await chord('P', 'KeyP', 80, SHIFT);
  await sleep(150);
  ok(P + 'J6 mod+Shift+P opens preview', await ev(`!!document.querySelector('.modal.compose iframe.previewframe')`));
  await chord('P', 'KeyP', 80, SHIFT);
  await sleep(150);
  ok(P + 'J6 mod+Shift+P in preview returns to text', await ev(`!!document.querySelector('.modal.compose textarea') && !document.querySelector('.modal.compose iframe.previewframe')`));
  await ev(`document.querySelector('.modal.compose label.field:nth-of-type(2) input').focus(); true`);
  await clear('__lastDraft');
  await chord('s', 'KeyS', 83);
  await sleep(300);
  ok(P + 'J6 mod+S from the To field saves a draft', (await last('__lastDraft'))?.body?.includes(sig), JSON.stringify(await last('__lastDraft')));

  // J7 Tastatur in der Liste: j/k, u, s, ⌫ mit Rückfrage (Abbrechen)
  await waitFor(`!document.querySelector('.modal.compose')`);
  await ev(`document.activeElement?.blur(); true`);
  await click('.msg', 'Angebot Q4');
  await sleep(200);
  await key('j', { text: 'j' });
  await waitFor(`document.querySelector('.readhead h1')?.textContent.includes('Terminvorschlag')`);
  ok(P + 'J7 j opens next message', true);
  await key('k', { text: 'k' });
  await waitFor(`document.querySelector('.readhead h1')?.textContent.includes('Angebot Q4')`);
  ok(P + 'J7 k opens previous message', true);
  await key('s', { text: 's' });
  await sleep(200);
  ok(P + 'J7 s toggles the star', (await ev(`document.querySelector('.readbar')?.textContent ?? ''`)).includes(t.unstar));
  b.setDialog(false);
  await clear('__lastDelete');
  const nd = b.dialogs.length;
  await key('Backspace', { code: 'Backspace', vk: 8 });
  await sleep(300);
  ok(P + 'J7 Backspace asks before deleting; cancel keeps it', b.dialogs.length === nd + 1 && (await last('__lastDelete')) === null);
  b.setDialog(true);

  // J8 Server-Suche: / fokussiert, Enter sucht, Esc beendet
  await key('/', { text: '/' });
  await sleep(100);
  ok(P + 'J8 / focuses search', await ev(`document.activeElement?.closest('.listbar') !== null`));
  await setVal('.listbar input', 'angebot');
  await key('Enter', { code: 'Enter', vk: 13 });
  await waitFor(`document.querySelectorAll('.msg').length === 1`);
  ok(P + 'J8 server search finds 1', (await ev(`document.querySelector('.listtitle').textContent`)).includes(t.searchResults));
  await key('Escape');
  await waitFor(`document.querySelectorAll('.msg').length === 3`);
  ok(P + 'J8 Esc ends search', true);

  // J9 Einstellungen: Seitengröße tippen („25“ bleibt 25), Ordner löschen nur eigene
  await click('.header button.icon');
  await waitFor(`document.querySelector('.modal.settings')`);
  await click('.set-tabs button', t.setReading);
  const ps = `[...document.querySelectorAll('.modal.settings input[type=number]')][0]`;
  for (const v of ['2', '25']) await ev(`(() => { const i = ${ps}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(100);
  ok(P + 'J9 typing 25 keeps 25', (await ev(`${ps}.value`)) === '25', await ev(`${ps}.value`));
  await ev(`(() => { const i = ${ps}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '3'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await click('.modal.settings button.primary');
  await sleep(250);
  const saved = await ev(`(async () => (await window.__TAURI_INTERNALS__.invoke('get_settings')).pageSize)()`);
  ok(P + 'J9 too small page size clamped to 10 on save', saved === 10, String(saved));
  await ev(`(window.__lastDeleteFolder = undefined, true)`);
  await ev(`(() => { const f = [...document.querySelectorAll('.sb-folder')].find(e => e.title === 'Sent'); f.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); return true; })()`);
  await sleep(200);
  ok(P + 'J9 role folder cannot be deleted by right-click', (await last('__lastDeleteFolder')) === null);
  b.setDialog(true);
  await ev(`(() => { const f = [...document.querySelectorAll('.sb-folder')].find(e => e.title === 'Newsletter'); f.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); return true; })()`);
  await sleep(300);
  ok(P + 'J9 own folder deleted after confirmation', (await last('__lastDeleteFolder'))?.name === 'Newsletter', JSON.stringify(await last('__lastDeleteFolder')));

  // J10 Neustart mitten im Schreiben: App startet sauber, Modus bleibt
  await key('n', { text: 'n' });
  await waitFor(`document.querySelector('.modal.compose textarea')`);
  await setVal('.modal.compose textarea', 'halb geschrieben');
  await b.nav(url);
  await waitFor(`document.querySelectorAll('.msg').length === 3`, 20000);
  await sleep(300);
  ok(P + 'J10 restart mid-compose: clean start, no editor, expert mode kept', !(await ev(`!!document.querySelector('.modal.compose')`)) && (await ev(`!!document.querySelector('.listbar select')`)));

  const errors = b.logs.filter((l) => !/favicon/.test(l));
  ok(P + 'no console errors', errors.length === 0, JSON.stringify(errors));
  b.close();
}

await run('de', 'MacIntel');
await run('en', 'Win32');
console.log(fail ? `${fail} FAILURES` : 'ALL OK');
process.exit(fail ? 1 : 0);
