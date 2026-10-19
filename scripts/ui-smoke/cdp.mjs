// Minimal-CDP-Treiber für headless Chrome (Node 22: globales WebSocket).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function launch(port = 9333) {
  const dir = mkdtempSync(join(process.env.SCRATCH || tmpdir(), 'chr-'));
  const proc = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else listeners.forEach(l => l(d));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, (d) => d.error ? rej(new Error(method + ': ' + JSON.stringify(d.error))) : res(d.result));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Page.enable'); await send('Runtime.enable');
  const logs = [];
  listeners.push(d => {
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map(a => a.value ?? a.description).join(' '));
  });
  let dialogAnswer = true; const dialogs = [];
  listeners.push(async d => {
    if (d.method === 'Page.javascriptDialogOpening') {
      dialogs.push(d.params.message);
      await send('Page.handleJavaScriptDialog', { accept: dialogAnswer });
    }
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n' + expr);
    return r.result.value;
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (expr, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(`!!(${expr})`)) return true; } catch {} await sleep(50); }
    throw new Error('timeout waiting for: ' + expr);
  };
  const key = async (key, opts = {}) => {
    const code = opts.code || key;
    const base = { key, code, windowsVirtualKeyCode: opts.vk || 0, modifiers: opts.modifiers || 0 };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: opts.text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(80);
  };
  const close = () => { try { ws.close(); } catch {} proc.kill('SIGKILL'); };
  return { send, ev, waitFor, sleep, key, close, logs, dialogs, setDialog: (v) => dialogAnswer = v, nav: (url) => send('Page.navigate', { url }) };
}
