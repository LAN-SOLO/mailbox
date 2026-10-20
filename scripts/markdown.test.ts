// Tests für den Markdown-Renderer des Editors (ohne Test-Framework):
//   pnpm test   (= node --experimental-strip-types scripts/markdown.test.ts)
import { markdownToHtml, hasMarkup, wrapText, stripQuotes, toggleQuote, escapeHtml } from '../src/markdown.ts';
let fail = 0;
const eq = (name: string, got: string | boolean, want: string | boolean) => {
  if (got !== want) { fail++; console.log('FAIL', name, '\n got:', got, '\nwant:', want); } else console.log('ok  ', name);
};
eq('bold', markdownToHtml('**fett**'), '<p><b>fett</b></p>');
eq('italic _', markdownToHtml('_k_'), '<p><i>k</i></p>');
eq('url underscores', markdownToHtml('siehe https://x.de/a_b_c/_d_'), '<p>siehe <a href="https://x.de/a_b_c/_d_">https://x.de/a_b_c/_d_</a></p>');
eq('url star', markdownToHtml('https://x.de/*a*/b'), '<p><a href="https://x.de/*a*/b">https://x.de/*a*/b</a></p>');
eq('link text emph', markdownToHtml('[**fett** Text](https://x.de/_y_)'), '<p><a href="https://x.de/_y_"><b>fett</b> Text</a></p>');
eq('xss text', markdownToHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
eq('xss link js', markdownToHtml('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
eq('xss quote in url', markdownToHtml('[x](https://a.de/"onmouseover="alert(1))'), '<p><a href="https://a.de/&quot;onmouseover=&quot;alert(1">x</a>)</p>');
eq('code keeps', markdownToHtml('`<b>` und _x_'), '<p><code>&lt;b&gt;</code> und <i>x</i></p>');
eq('list', markdownToHtml('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
eq('quote', markdownToHtml('> zitat\n> zwei'), '<blockquote><p>zitat<br>zwei</p></blockquote>');
eq('hasMarkup plain', hasMarkup('Hallo Welt, wie geht es?'), false);
eq('hasMarkup bold', hasMarkup('ein **wort**'), true);
eq('wrap', wrapText('a '.repeat(50).trim(), 20).split('\n').every((l) => l.length <= 20), true);
{
  const long = 'wort '.repeat(30).trim();
  const sig = 'Max Muster · Beispiel GmbH · Musterstraße 1 · 12345 Musterstadt · Tel. +49 000 000000';
  const w = wrapText(`${long}\n\n\`\`\`\n${long}\n\`\`\`\n\n-- \n${sig}`).split('\n');
  eq('wrap body', w.slice(0, w.indexOf('')).every((l) => l.length <= 72), true);
  eq('wrap keeps code block', w.includes(long), true);
  eq('wrap keeps signature', w[w.length - 1], sig);
  // Antwort/Weiterleitung: Signatur über dem Original — Text darunter wird
  // weiter umbrochen (Runde 3 hatte alles ab „-- “ eingefroren).
  const below = wrapText(`\n\n-- \n${sig}\n\nAm 1.1. schrieb A:\n> ${long}\n\n${long}`).split('\n');
  eq('wrap keeps signature above quote', below.includes(sig), true);
  eq('wrap keeps quote', below.includes(`> ${long}`), true);
  eq('wrap text below signature and quote', below.filter((l) => !l.startsWith('>') && l !== sig).every((l) => l.length <= 72), true);
  // Mehrzeilige Kontosignatur mit Leerzeile: genau diese bleibt stehen.
  const sig2 = `${sig}\n\n${sig}`;
  const two = wrapText(`-- \n${sig2}\n\n${long}`, 72, sig2).split('\n');
  eq('wrap keeps multi-paragraph account signature', two.filter((l) => l === sig).length, 2);
  eq('wrap after account signature', two[two.length - 1].length <= 72, true);
  // „-- “ im Code-Block ist keine Signatur.
  const code = wrapText(`\`\`\`\n-- \n\`\`\`\n${long}`).split('\n');
  eq('wrap: "-- " inside code is no signature', code.every((l) => l.length <= 72), true);
}
eq('stripQuotes', stripQuotes('Hi\n\nAm Mo schrieb X:\n> a\n> b'), 'Hi');
eq('toggleQuote', toggleQuote(toggleQuote('a\nb')), 'a\nb');
eq('escape', escapeHtml('<"&>'), '&lt;&quot;&amp;&gt;');
if (fail) { console.log(fail, 'failures'); process.exit(1); }
