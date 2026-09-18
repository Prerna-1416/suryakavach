// dev.mjs — single command that boots the Suryakavach backend (FastAPI/uvicorn)
// and the operator-console frontend (Vite) together, then tears both down
// on exit. Ports already in use (e.g. you started one half yourself) are
// reused instead of double-launched.
//
//   npm run dev        -> backend on :8000 + web on :5173
//   npm run dev:web    -> frontend only
//   npm run dev:api    -> backend only
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROXY_API = 'http://127.0.0.1:8000';
const ONE_SECOND = 1000;

function isListening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { try { s.destroy(); } catch {} resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(800, () => done(false));
  });
}

async function waitForApi(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(PROXY_API + '/api/health');
      if (r.ok) return true;
    } catch {}
    await new Promise((res) => setTimeout(res, 800));
  }
  return false;
}

const procs = [];
function start(pid) {
  procs.push(pid);
  pid.stdout.setEncoding('utf8');
  pid.stderr.setEncoding('utf8');
  pid.stdout.pipe(process.stdout);
  pid.stderr.pipe(process.stderr);
  pid.once('exit', () => {
    const i = procs.indexOf(pid);
    if (i >= 0) procs.splice(i, 1);
  });
  return pid;
}

function startBackend() {
  const cwd = path.join(ROOT, 'backend');
  const apiProc = spawn('python', ['-m', 'uvicorn', 'suryakavach.api:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONPATH: cwd, PYTHONUNBUFFERED: '1' },
    windowsHide: true,
  });
  return start(apiProc);
}

function startWeb() {
  const cwd = path.join(ROOT, 'apps', 'web');
  const webProc = spawn('npm.cmd', ['run', 'dev', '--', '--port', '5173'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true,
  });
  return start(webProc);
}

const which = process.argv[2] || 'all';
const jobs = [];

if (which === 'all' || which === 'api') {
  if (await isListening(8000)) {
    console.log('Suryakavach backend already running on :8000 — reusing.');
  } else {
    console.log('Starting Suryakavach backend (uvicorn) on http://127.0.0.1:8000 ...');
    jobs.push(startBackend());
    const up = await waitForApi(45 * ONE_SECOND);
    console.log(up ? 'Backend healthy.' : 'Backend took too long — check backend logs.');
  }
}

if (which === 'all' || which === 'web') {
  if (await isListening(5173)) {
    console.log('Web dev server already running on :5173 — reusing.');
  } else {
    console.log('Starting Vite dev server on http://localhost:5173 ...');
    jobs.push(startWeb());
  }
}

let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${sig} received — stopping Suryakavach processes.`);
  for (const pid of procs) {
    try { pid.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', () => shutdown('Ctrl+C (SIGINT)'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', () => { for (const pid of procs) { try { pid.kill('SIGKILL'); } catch {} } });
