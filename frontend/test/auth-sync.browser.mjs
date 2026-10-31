// Run after building: CHROME_BIN=/path/to/chrome node frontend/test/auth-sync.browser.mjs
// Uses an isolated browser profile and a fake HTTP API; never touches the app database.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const user = { id: 1, username: 'logout-test', rooms: [] };
let signedIn = true;
let failLogout = false;
let failMe = false;
let logoutRequests = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) {
    let status = 200, body = {};
    if (path === '/api/me') {
      status = failMe ? 503 : signedIn ? 200 : 401;
      body = status === 200 ? user : { error: 'Session check failed' };
    } else if (path === '/api/logout') {
      logoutRequests++;
      status = failLogout ? 503 : 200;
      if (!failLogout) signedIn = false;
      body = status === 200 ? { ok: true } : { error: 'Try again' };
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }
  try {
    const file = join(root, path === '/' ? 'index.html' : path);
    const body = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(message);
}
const connections = [];
const profile = await mkdtemp(join(tmpdir(), 'voice-auth-browser-'));
let chrome;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(process.env.CHROME_BIN || '/opt/google/chrome/chrome', [
    '--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  let spawnError;
  chrome.on('error', error => { spawnError = error; });
  let port;
  await until(async () => {
    if (spawnError) throw spawnError;
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return true; } catch { return false; }
  }, 'Chrome did not start');

  async function page() {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    connections.push(ws);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    const pending = new Map();
    let id = 0;
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 10_000);
      pending.set(requestId, { resolve, reject, timeout });
      ws.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await command('Page.enable');
    await command('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('makeshift.locale','en');" });
    const reload = async () => {
      await command('Page.navigate', { url: origin });
      await until(() => evaluate("!!document.querySelector('.app-account')"), 'Page did not sign in');
    };
    const logout = async () => {
      await command('Page.bringToFront');
      await evaluate("document.querySelector('.app-account').dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, button:0, pointerType:'mouse' }))");
      await until(() => evaluate("!!document.querySelector('[role=menu]')"), 'Menu did not open');
      await evaluate("Array.from(document.querySelectorAll('[role=menuitem]')).find(e=>e.textContent === 'Log out').click()");
    };
    const isLoggedOut = () => evaluate("!document.querySelector('.app-account') && !!document.querySelector('form')");
    await reload();
    return { command, evaluate, reload, logout, isLoggedOut };
  }

  const first = await page(), second = await page();
  await first.logout();
  await until(first.isLoggedOut, 'Initiating tab stayed signed in');
  await until(second.isLoggedOut, 'Other tab missed logout broadcast');
  assert.equal(logoutRequests, 1, 'Receiving tab must not call logout again');
  console.log('PASS: logout reaches both tabs with one HTTP request');

  signedIn = true;
  await first.reload(); await second.reload();
  failLogout = true;
  await first.logout();
  await until(() => first.evaluate("!!document.querySelector('[role=alert]')"), 'Missing logout error');
  assert.equal(await second.isLoggedOut(), false);
  assert.equal(await first.evaluate("!!document.querySelector('.app-account')"), true);
  failLogout = false;
  console.log('PASS: failed logout leaves both tabs signed in');

  // Hold a stale successful /me response in the first tab, then log out elsewhere.
  await first.reload();
  await first.evaluate(`
    Object.defineProperty(document, 'visibilityState', { configurable:true, get:()=> 'visible' });
    const originalFetch = window.fetch;
    window.fetch = (url, options) => String(url) === '/api/me'
      ? new Promise(resolve => { window.releaseMe = () => resolve(new Response(${JSON.stringify(JSON.stringify(user))}, { status:200 })); })
      : originalFetch(url, options);
    window.dispatchEvent(new Event('focus'));
  `);
  await second.logout();
  await until(first.isLoggedOut, 'Pending /me prevented logout');
  await first.evaluate('window.releaseMe()');
  await sleep(150);
  assert.equal(await first.isLoggedOut(), true, 'Stale /me restored authentication');
  console.log('PASS: in-flight session response cannot undo logout');

  // Simulate a browser where BroadcastChannel is unavailable, or a missed notification.
  signedIn = true;
  await second.command('Page.addScriptToEvaluateOnNewDocument', { source: 'window.BroadcastChannel = undefined;' });
  await second.reload();
  await second.evaluate("Object.defineProperty(document, 'visibilityState', { configurable:true, get:()=> 'visible' })");
  failMe = true;
  await second.evaluate("window.dispatchEvent(new Event('focus'))");
  await sleep(200);
  assert.equal(await second.isLoggedOut(), false, 'Network failure must not end an existing session');
  failMe = false;
  signedIn = false;
  await second.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await until(second.isLoggedOut, 'Tab activation did not detect a revoked session');
  assert.equal(logoutRequests, 3);
  console.log('PASS: activation detects revocation without BroadcastChannel; transient errors preserve auth');
} finally {
  for (const connection of connections) connection.close();
  if (chrome?.pid && chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await new Promise(resolve => chrome.once('exit', resolve));
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
