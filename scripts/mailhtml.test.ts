// Tests für die Verpackung fremder HTML-Mails (ohne Test-Framework):
//   pnpm test
import { wrapHtml } from '../src/mailHtml.ts';
let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) { fail++; console.log('FAIL', name, extra); } else console.log('ok  ', name);
};
const T = 'https://tracker.example';
const hostile = `<img src="${T}/a"><html><head><LINK rel=preconnect href="${T}"><link rel="dns-prefetch" href="//${T}"/></head><body><iframe src="${T}/f"></iframe><object data="${T}/o"></object><embed src="${T}/e"><FRAME src="${T}/fr"><p>Text <a href="${T}/x">Link</a></p></body></html>`;
const blocked = wrapHtml(hostile, false);
ok('CSP meta is the very first element', blocked.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
ok('remote images blocked', /img-src data:;/.test(blocked) && !/img-src[^;]*https:/.test(blocked));
ok('remote images allowed on demand', /img-src data: https: http:;/.test(wrapHtml(hostile, true)));
ok('dns prefetch off before mail content', blocked.indexOf('x-dns-prefetch-control') < blocked.indexOf(T));
ok('no <link> survives', !/<link[\s/>]/i.test(blocked), blocked);
ok('no frame/object/embed survives', !/<\/?(iframe|frame|object|embed)[\s/>]/i.test(blocked), blocked);
ok('text and links kept', blocked.includes('<p>Text <a href="https://tracker.example/x">Link</a></p>'));
ok('lookalike tags untouched', wrapHtml('<linked>x</linked><embedded>', false).includes('<linked>x</linked><embedded>'));
if (fail) { console.log(fail, 'failures'); process.exit(1); }
