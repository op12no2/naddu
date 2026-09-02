// Run an example page in headless chromium and print its results, e.g.
//   node tooling/example.js examples/mates.html
// Waits for #summary to be filled in (or 30s), then prints #results and #summary.
// Serves the repo root on a local port, needs the playwright chromium headless shell.

const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const bin = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const port = 8765;
const page = process.argv[2];

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {cwd: root, stdio: 'ignore'});
const chrome = spawn(bin, ['--headless', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9333', 'about:blank'], {stdio: 'ignore'});

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function finish(code) {
  chrome.kill();
  server.kill();
  process.exit(code);
}

async function main() {

  let targets = null;
  for (let i = 0; i < 50 && !targets; i++) {
    try {
      targets = await (await fetch('http://127.0.0.1:9333/json')).json();
    }
    catch (e) {
      await sleep(200);
    }
  }

  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  let id = 0;
  const pending = {};

  function send(method, params) {
    return new Promise(function(res) {
      pending[++id] = res;
      ws.send(JSON.stringify({id: id, method: method, params: params}));
    });
  }

  function evaluate(expr) {
    return send('Runtime.evaluate', {expression: expr, returnByValue: true}).then(function(r) { return r.result.value; });
  }

  ws.onmessage = function(m) {
    const d = JSON.parse(m.data);
    if (pending[d.id])
      pending[d.id](d.result);
  };

  await new Promise(function(r) { ws.onopen = r; });
  await send('Page.enable', {});
  await send('Page.navigate', {url: 'http://127.0.0.1:' + port + '/' + page});

  let summary = '';
  for (let i = 0; i < 150 && !summary; i++) {
    await sleep(200);
    summary = await evaluate("(document.getElementById('summary') || {}).textContent || ''");
  }

  console.log(await evaluate("(document.getElementById('results') || document.body).innerText"));
  console.log(summary);
  ws.close();
  finish(summary.indexOf('FAIL') >= 0 || /(\d+) of (\d+)/.test(summary) && RegExp.$1 !== RegExp.$2 ? 1 : 0);
}

main();
