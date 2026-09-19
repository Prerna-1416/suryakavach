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
const isWindows = process.platform === 'win32';

const procs = [];
let shuttingDown = false;

function shutdown(sig, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${sig} received — stopping Suryakavach processes.`);
  for (const pid of procs) {
    try { pid.kill('SIGTERM'); } catch {}
  }
  if (exitCode !== 0) {
    process.exit(exitCode);
  } else {
    setTimeout(() => process.exit(0), 500);
  }
}

process.on('SIGINT', () => shutdown('Ctrl+C (SIGINT)', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('exit', () => { for (const pid of procs) { try { pid.kill('SIGKILL'); } catch {} } });

function isListening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { try { s.destroy(); } catch {} resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(800, () => done(false));
  });
}

async function checkApiHealth() {
  try {
    const r = await fetch(PROXY_API + '/api/health', {
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
}


async function waitForApi(backendProc, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  
  const onExit = () => { exited = true; };
  backendProc.once('exit', onExit);

  while (Date.now() < deadline) {
    if (exited) {
      backendProc.off('exit', onExit);
      return false;
    }
    if (await checkApiHealth()) {
      backendProc.off('exit', onExit);
      return true;
    }
    await new Promise((res) => setTimeout(res, 800));
  }
  backendProc.off('exit', onExit);
  return false;
}

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
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';
  const webProc = spawn(npmCmd, ['run', 'dev', '--', '--port', '5173'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows,
    windowsHide: true,
  });
  return start(webProc);
}

const which = process.argv[2] || 'all';

if (which === 'all' || which === 'api') {
  if (await isListening(8000)) {
    if (await checkApiHealth()) {
      console.log('Suryakavach backend already running & healthy on :8000 — reusing.');
    } else {
      console.error('Error: Port 8000 is occupied by an unresponsive or non-Suryakavach process.');
      shutdown('Port Conflict', 1);
    }
  } else {
    console.log('Starting Suryakavach backend (uvicorn) on http://127.0.0.1:8000 ...');
    const backendProc = startBackend();
    const up = await waitForApi(backendProc, 45 * ONE_SECOND);
    if (up) {
      console.log('Backend healthy.');
    } else {
      console.error('Backend startup failed or timed out — check backend logs.');
      shutdown('Backend Startup Failed', 1);
    }
  }
}

if (which === 'all' || which === 'web') {
  if (await isListening(5173)) {
    console.log('Web dev server already running on :5173 — reusing.');
  } else {
    console.log('Starting Vite dev server on http://localhost:5173 ...');
    startWeb();
  }
}
