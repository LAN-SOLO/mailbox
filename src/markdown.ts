// Kleiner Markdown→HTML-Renderer für den Expertenmodus des Editors.
// Bewusst ohne Abhängigkeit und ohne Ehrgeiz: das Nötigste, was in einer
// E-Mail sinnvoll ist — Absätze, Überschriften, Listen, Zitate, Code,
// Links, fett/kursiv/durchgestrichen, Trennlinie. Der Klartext (Markdown)
// bleibt in der Mail als text/plain-Teil erhalten, deshalb darf die
// HTML-Fassung schlicht sein.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const URL_RE = /((?:https?:\/\/|mailto:)[^\s<>()]+[^\s<>().,;:!?'"])/g;

function inline(raw: string): string {
  // Code-Spans zuerst herauslösen, damit ihr Inhalt unangetastet bleibt.
  const codes: string[] = [];
  let s = raw.replace(/`([^`\n]+)`/g, (_, c: string) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  // Links [Text](url) — nur http(s)/mailto, alles andere bleibt Text.
  s = s.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, t: string, u: string) => {
    return `<a href="${u}">${t}</a>`;
  });
  // Nackte URLs verlinken (außerhalb bereits gesetzter Anker).
  s = s
    .split(/(<a [^>]*>.*?<\/a>)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(URL_RE, '<a href="$1">$1</a>')))
    .join('');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  s = s.replace(/(^|[^\w*])\*(\S(?:[^*\n]*\S)?)\*(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^\w_])_(\S(?:[^_\n]*\S)?)_(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
  return s;
}

/** Rendert Markdown-Blöcke; wird für Zitate rekursiv aufgerufen. */
function blocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para.length = 0;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') {
      flush();
      i++;
      continue;
    }
    if (/^```/.test(trimmed)) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (h) {
      flush();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^>/.test(trimmed)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*> ?/, ''));
      out.push(`<blockquote>${blocks(buf)}</blockquote>`);
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ''));
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      out.push(`<ol>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out.join('\n');
}

/** Markdown → HTML-Fragment (ohne <html>/<body>). */
export function markdownToHtml(md: string): string {
  return blocks(md.replace(/\r\n?/g, '\n').split('\n'));
}

const MAIL_CSS =
  'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;margin:0;padding:12px}' +
  'p{margin:0 0 1em}h1{font-size:1.4em;margin:1em 0 .5em}h2{font-size:1.2em;margin:1em 0 .5em}h3{font-size:1.05em;margin:1em 0 .4em}' +
  'blockquote{margin:0 0 1em;padding:0 0 0 .8em;border-left:3px solid #cbd5e1;color:#475569}' +
  'code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;background:#f1f5f9;padding:1px 4px;border-radius:3px}' +
  'pre{background:#f1f5f9;padding:10px;border-radius:4px;overflow:auto}pre code{background:none;padding:0}' +
  'ul,ol{margin:0 0 1em;padding-left:1.4em}hr{border:0;border-top:1px solid #cbd5e1;margin:1em 0}a{color:#0369a1}';

/** Vollständiges HTML-Dokument für den Versand und die Vorschau. */
export function markdownToMailHtml(md: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${MAIL_CSS}</style></head><body>${markdownToHtml(md)}</body></html>`;
}

/** true, wenn der Text Markdown-Auszeichnungen enthält, die im HTML-Teil
 *  sichtbar würden — dann lohnt sich der HTML-Teil überhaupt. */
export function hasMarkup(md: string): boolean {
  return /(\*\*|~~|`|^#{1,3}\s|^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*>|\]\(|^(-{3,}|\*{3,})$|(^|[^\w*])\*\S(?:[^*\n]*\S)?\*(?!\w)|(^|[^\w_])_\S(?:[^_\n]*\S)?_(?!\w))/m.test(md);
}

// --- Text-Werkzeuge für den Editor ----------------------------------------

/** Harter Umbruch bei `width` Zeichen; Zitatzeilen und Signatur bleiben. */
export function wrapText(text: string, width = 72): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.length <= width || /^\s*>/.test(line) || line === '-- ') return line;
      const words = line.split(' ');
      const out: string[] = [];
      let cur = '';
      for (const w of words) {
        if (cur && (cur + ' ' + w).length > width) {
          out.push(cur);
          cur = w;
        } else cur = cur ? `${cur} ${w}` : w;
      }
      if (cur) out.push(cur);
      return out.join('\n');
    })
    .join('\n');
}

/** Entfernt alle Zitatzeilen (`> …`) samt der Zitat-Kopfzeile davor. */
export function stripQuotes(text: string): string {
  const lines = text.split('\n');
  const keep: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>/.test(l)) continue;
    // Kopfzeile „Am … schrieb …:“ / „On … wrote:“ direkt vor einem Zitat
    if (/:\s*$/.test(l) && /^\s*>/.test(lines[i + 1] ?? '')) continue;
    keep.push(l);
  }
  return keep.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

/** Setzt `> ` vor jede Zeile (bzw. entfernt es, wenn alle schon zitiert sind). */
export function toggleQuote(text: string): string {
  const lines = text.split('\n');
  const allQuoted = lines.every((l) => l.trim() === '' || /^\s*>/.test(l));
  return lines
    .map((l) => (allQuoted ? l.replace(/^\s*> ?/, '') : l.trim() === '' ? l : `> ${l}`))
    .join('\n');
}
