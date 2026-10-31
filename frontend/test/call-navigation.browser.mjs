// Run: CHROME_BIN=/path/to/chrome node frontend/test/call-navigation.browser.mjs
// Uses an isolated browser profile and a fake HTTP API; never touches the app database.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const user = { id: 1, username: 'tester', rooms: [{ name: 'Friends across Japan, Canada, Scotland and China', code: null }, { name: 'other', code: null }] };
let signedIn = true;
const cacheDir = await mkdtemp(join(tmpdir(), 'voice-call-vite-'));
const server = await createServer({
  cacheDir,
  configFile: false, root,
  plugins: [react(), tailwindcss(), {
    name: 'fake-api', configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url.split('?')[0];
        if (!path.startsWith('/api/')) return next();
        let body = {};
        if (path === '/api/me') body = user;
        if (path === '/api/logout') signedIn = false;
        if (path === '/api/livekit-token') body = { token: 'test-token', url: 'ws://mock' };
        if (path === '/api/diagnostics/overview') body = { revision: 'test', data: { calls: [], attempts: [], server: null, storage: { bytes: 0, budget: 262144000 } } };
        res.writeHead(path === '/api/me' && !signedIn ? 401 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    },
  }],
  resolve: { alias: [
    { find: 'livekit-client', replacement: fileURLToPath(new URL('./fixtures/call-sdk.mjs', import.meta.url)) },
    { find: '@/diagnostics/telemetry', replacement: fileURLToPath(new URL('./fixtures/call-telemetry.mjs', import.meta.url)) },
    { find: '@', replacement: join(root, 'src') },
  ] },
  server: { host: '127.0.0.1', port: 0, watch: null },
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
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
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
    await command('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('makeshift.locale','en');localStorage.setItem('voice-noise-mode','browser');localStorage.setItem('makeshift.theme','dark');" });
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

  const first = await page();
  await first.command('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  const read = first.evaluate;
  await read(`document.querySelector('.channel-open').click()`);
  await until(() => read(`window.callTest.connects===1 && !!document.querySelector('.participant-tile') && !document.querySelector('.call-mute').disabled`), 'Call failed to join');
  const attached = await read(`window.callTest.attached`);
  const detached = await read(`window.callTest.detached`);
  await read(`(()=>{const input=document.querySelector('.participant-volume input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'150');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(() => read(`window.callTest.volume===1.5`), 'Participant volume not applied');
  await read(`document.querySelector('.app-brand-name').click()`);
  await until(() => read(`!!document.querySelector('.call-dock') && !!document.querySelector('.lobby-page')`), 'Call did not minimize');
  assert.equal(await read(`window.callTest.disconnects`), 0);
  assert.equal(await read(`window.callTest.attached`), attached);
  assert.equal(await read(`window.callTest.detached`), detached);
  assert.equal(await read(`window.callTest.telemetryFinished`), 0);
  assert.equal(await read(`window.callTest.volume`), 1.5);
  for (const [label, locale] of [['中文','zh'], ['日本語','ja'], ['English','en']]) {
    await read(`document.querySelector('.app-header-actions button[title]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`);
    await until(() => read(`!!document.querySelector('[role=menuitemradio]')`), 'Language menu missing');
    await read(`Array.from(document.querySelectorAll('[role=menuitemradio]')).find(e=>e.textContent===${JSON.stringify(label)}).click()`);
    await until(() => read(`document.documentElement.lang===${JSON.stringify(locale)}`), 'Locale did not change');
    await first.command('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    assert.equal(await read(`document.querySelector('.call-dock').getBoundingClientRect().right<=innerWidth`), true);
    await first.command('Page.captureScreenshot').then(r=>writeFile(`/tmp/voice-call-dock-${locale}.png`,Buffer.from(r.data,'base64')));
  }
  await first.command('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  assert.equal(await read(`window.callTest.connects`), 1);

  await read(`document.querySelector('.call-dock-actions button[aria-pressed]').click()`);
  await until(() => read(`document.querySelector('.call-dock-actions button[aria-pressed]').getAttribute('aria-pressed')==='true'`), 'Dock mute failed');
  await read(`window.callTest.rooms[0].emit('DataReceived',new TextEncoder().encode(JSON.stringify({text:'hello while minimized'})),{identity:'friend'},null,'chat')`);
  await until(() => read(`!!document.querySelector('.call-dock-unread')`), 'Missing unread indicator');
  await read(`document.querySelector('.call-dock-return').click()`);
  await until(() => read(`!!document.querySelector('.call-page')`), 'Return to call failed');
  assert.equal(await read(`window.callTest.connects`), 1);
  await read('history.back()');
  await until(() => read(`!!document.querySelector('.call-dock')`), 'Back did not minimize');
  await read('history.forward()');
  await until(() => read(`!!document.querySelector('.call-page')`), 'Forward did not restore call');
  assert.equal(await read(`window.callTest.connects`), 1);
  await read(`Array.from(document.querySelectorAll('.call-tab')).find(e=>e.textContent.includes('Chat')).click()`);
  await until(() => read(`document.querySelector('.chat-messages').textContent.includes('hello while minimized')`), 'Chat lost on return');
  await read(`(()=>{const input=document.querySelector('.chat-compose input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'draft stays');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await read(`document.querySelector('.app-brand-name').click()`);
  await read(`document.querySelector('.app-account').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}))`);
  await until(() => read(`!!document.querySelector('[role=menu]')`), 'Menu did not open');
  await read(`document.querySelector('[role=menu] a[href="/diagnostics"]').click()`);
  await until(() => read(`!!document.querySelector('.diagnostics') && !!document.querySelector('.call-dock')`), 'Diagnostics did not keep call');
  assert.equal(await read(`window.callTest.disconnects`), 0);
  await first.command('Page.captureScreenshot').then(r=>writeFile('/tmp/voice-call-dock-desktop.png',Buffer.from(r.data,'base64')));
  await first.command('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
  assert.equal(await read(`(()=>{const r=document.querySelector('.call-dock').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && Math.abs((r.left+r.right)/2-innerWidth/2)<2})()`),true);
  await first.command('Page.captureScreenshot').then(r=>writeFile('/tmp/voice-call-dock-mobile.png',Buffer.from(r.data,'base64')));
  // Inspect the same layout in light theme without changing the active connection.
  await read(`document.documentElement.classList.remove('dark')`);
  await first.command('Page.captureScreenshot').then(r=>writeFile('/tmp/voice-call-dock-light.png',Buffer.from(r.data,'base64')));
  await read(`document.documentElement.classList.add('dark')`);
  await read(`document.querySelector('.call-dock-return').click()`);
  await first.command('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await read(`Array.from(document.querySelectorAll('.call-tab')).find(e=>e.textContent.includes('Chat')).click()`);
  assert.equal(await read(`document.querySelector('.chat-compose input').value`),'draft stays');
  await read(`document.querySelector('.app-brand-name').click()`);
  await read(`Array.from(document.querySelectorAll('.channel-open')).find(e=>e.textContent.includes('other')).click()`);
  await until(() => read(`window.callTest.connects===2 && window.callTest.disconnects===1`), 'Channel switch failed');
  assert.equal(await read(`window.callTest.maxConcurrent`), 1);
  await read(`document.querySelector('.app-brand-name').click()`);
  await read(`document.querySelector('.call-dock-actions button[aria-label="Leave"]').click()`);
  await until(() => read(`window.callTest.disconnects===2 && !document.querySelector('.call-dock')`), 'Dock leave failed');
  await read(`document.querySelector('.channel-open').click()`);
  await until(() => read(`window.callTest.connects===3`), 'Rejoin failed');
  // Cross-tab logout must unmount the provider and disconnect the active call.
  const second = await page();
  await second.logout();
  await until(() => read(`window.callTest.disconnects===3`) , 'Cross-tab logout did not disconnect call');
  await until(first.isLoggedOut, 'Call tab stayed signed in');
  console.log('PASS: one connection across channels/diagnostics navigation, persistent audio/chat/draft, dock mute/unread/return/leave, serialized channel switching, and cross-tab logout teardown. Mock SDK; no live microphone.');

} finally {
  for (const connection of connections) connection.close();
  if (chrome?.pid && chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await new Promise(resolve => chrome.once('exit', resolve));
  }
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
