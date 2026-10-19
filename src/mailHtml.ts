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
  const defused = html
    .replace(/<link(?=[\s/>])/gi, '<meta data-link')
    .replace(/<(\/?)(iframe|frame|frameset|object|embed|applet|portal)(?=[\s/>])/gi, '<$1x-$2');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><meta http-equiv="x-dns-prefetch-control" content="off"><meta charset="utf-8"><meta name="referrer" content="no-referrer">${reset}${defused}`;
}
