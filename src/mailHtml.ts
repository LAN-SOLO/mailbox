// Darstellung fremder HTML-Mails im abgeschotteten iframe (srcdoc).
// Eigenes Modul, damit `pnpm test` es ohne React/Tauri prüfen kann.

/** HTML-Mail in ein eigenständiges Dokument mit strenger CSP verpacken.
 *
 *  Die CSP-Meta steht als allererstes Element im Dokument: Der HTML-Parser
 *  legt sie in den <head>, bevor irgendetwas aus der Mail geparst wird.
 *  (Bis 0.1 wurde sie hinter das erste <head> der Mail gesetzt — ein
 *  <img> *vor* dem <head> lud dann trotz Sperre.) Die Mail selbst bleibt
 *  unverändert dahinter; ihre <html>/<head>-Tags verschmelzen mit unseren
 *  (ein eigenes <!doctype> der Mail ist dahinter wirkungslos — wir setzen
 *  immer den Standardmodus).
 *  Ohne `allow-scripts` laufen ohnehin keine Skripte, Formulare und
 *  Navigation sind über die Sandbox bzw. die App-CSP (frame-src) gesperrt. */
export function wrapHtml(html: string, remote: boolean): string {
  const img = remote ? 'img-src data: https: http:' : 'img-src data:';
  const csp = `default-src 'none'; ${img}; style-src 'unsafe-inline'; font-src data:; form-action 'none'`;
  const reset =
    '<style>html,body{margin:0;padding:12px;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;word-break:break-word}img{max-width:100%;height:auto}a{color:#0369a1}pre{white-space:pre-wrap}</style>';
  // <link rel=preconnect/dns-prefetch> und eingebettete Rahmen (<iframe>,
  // <object> …) öffnen Verbindungen an der CSP vorbei — der Browser baut die
  // TCP-Verbindung auf, bevor die CSP die Anfrage sperrt (Tracking ohne Bild,
  // im Chromium-Test nachgewiesen). Laden dürfen sie ohnehin nichts: <link>
  // wird zu einem wirkungslosen <meta>, Rahmen zu unbekannten Elementen.
  // Dazu die DNS-Vorabauflösung für Links abschalten (http-Ursprung auf Windows).
  // http-equiv aus der Mail (refresh = Weiterleitung des Rahmens auf eine
  // fremde Adresse, eigene CSP/Prefetch-Schalter) wirkt nicht mehr: Chromium
  // sperrt refresh in der Sandbox ohnehin (gemessen), WebKit ist hier nicht
  // automatisiert geprüft — darum vorsorglich entschärft (seit 1.0, Runde 2).
  // Verifikation Runde 2: Das Attribut wird mit einem kleinen Tokenizer nach
  // HTML-Regeln gesucht (Anführungszeichen, „>“ in Werten) und auch in
  // <link>-Tags entschärft — die werden hier zu <meta> und würden sonst mit
  // http-equiv zu einer aktiven Weiterleitung.
  const defused = defuseHttpEquiv(html)
    .replace(/<link(?=[\s/>])/gi, '<meta data-link')
    .replace(/<(\/?)(iframe|frame|frameset|object|embed|applet|portal)(?=[\s/>])/gi, '<$1x-$2');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><meta http-equiv="x-dns-prefetch-control" content="off"><meta charset="utf-8"><meta name="referrer" content="no-referrer">${reset}${defused}`;
}

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/** `http-equiv` in <meta>/<link>-Tags der Mail zu `data-http-equiv` machen.
 *  Liest die Attribute wie der HTML-Tokenizer (WHATWG 13.2.5.32 ff.):
 *  Werte in "…" oder '…' dürfen „>“ enthalten, Namen enden an Leerraum,
 *  „/“, „>“ oder „=“. Linear, ohne Rückverfolgung. */
export function defuseHttpEquiv(html: string): string {
  const re = /<(meta|link)(?=[\s/>])/gi;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let i = m.index + m[0].length;
    const n = html.length;
    while (i < n) {
      while (i < n && (isSpace(html[i]) || html[i] === '/')) i++;
      if (i >= n || html[i] === '>') break;
      const start = i;
      i++; // erstes Zeichen gehört immer zum Namen (auch „=“)
      while (i < n && !isSpace(html[i]) && html[i] !== '/' && html[i] !== '>' && html[i] !== '=') i++;
      if (html.slice(start, i).toLowerCase() === 'http-equiv') {
        out += html.slice(last, start) + 'data-http-equiv';
        last = i;
      }
      let j = i;
      while (j < n && isSpace(html[j])) j++;
      if (html[j] !== '=') continue;
      i = j + 1;
      while (i < n && isSpace(html[i])) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        const end = html.indexOf(q, i + 1);
        i = end < 0 ? n : end + 1;
      } else {
        while (i < n && !isSpace(html[i]) && html[i] !== '>') i++;
      }
    }
    re.lastIndex = Math.max(i, m.index + 1);
  }
  return out + html.slice(last);
}
