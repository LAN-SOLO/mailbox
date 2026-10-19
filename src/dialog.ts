// Rückfragen über den nativen Dialog des Dialog-Plugins.
//
// Achtung: `window.confirm` taugt im Tauri-WebView nicht — das Dialog-Plugin
// ersetzt es durch eine *async* Funktion (liefert ein Promise, also immer
// „wahr“), und auf macOS kennt WKWebView ohne UI-Delegate gar keinen
// Bestätigungsdialog. Bis 0.1 liefen Löschen, Papierkorb leeren, Ordner und
// Konto entfernen deshalb ohne echte Rückfrage durch. Hier wird das Ergebnis
// immer abgewartet.
import { confirm } from '@tauri-apps/plugin-dialog';

export async function ask(
  message: string,
  labels: { ok: string; cancel: string },
  danger = true
): Promise<boolean> {
  try {
    return await confirm(message, {
      title: 'mailbox',
      kind: danger ? 'warning' : 'info',
      okLabel: labels.ok,
      cancelLabel: labels.cancel,
    });
  } catch {
    // Kein Plugin (z. B. Browser ohne Mock): Browser-Dialog, sonst „nein“.
    try {
      return Boolean(await Promise.resolve(window.confirm(message)));
    } catch {
      return false;
    }
  }
}
