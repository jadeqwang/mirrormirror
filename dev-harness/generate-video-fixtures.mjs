import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const outputDir = resolve("fixtures/video");
const workDir = await mkdtemp(join(tmpdir(), "mirrormirror-video-"));
await mkdir(outputDir, { recursive: true });

let resolveUploads;
const uploadsDone = new Promise((resolvePromise) => { resolveUploads = resolvePromise; });
const received = new Set();
const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url?.startsWith("/upload/")) {
    const name = request.url.slice("/upload/".length);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    await writeFile(join(outputDir, `${name}.webm`), Buffer.concat(chunks));
    received.add(name);
    response.end("ok");
    if (received.size === 3) resolveUploads();
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(renderPage());
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address();
const browser = process.env.BROWSER ?? "google-chrome";
const chrome = spawn(browser, [
  "--headless=new",
  "--no-sandbox",
  "--autoplay-policy=no-user-gesture-required",
  `--user-data-dir=${join(workDir, "profile")}`,
  `http://127.0.0.1:${port}`,
], { stdio: "inherit" });

const timeout = setTimeout(() => chrome.kill("SIGTERM"), 30_000);
try {
  await Promise.race([
    uploadsDone,
    once(chrome, "exit").then(() => { throw new Error("Browser exited before fixtures were generated"); }),
  ]);
  console.log(`Generated ${[...received].sort().join(", ")} in ${outputDir}`);
} finally {
  clearTimeout(timeout);
  if (chrome.exitCode === null) {
    chrome.kill("SIGTERM");
    await once(chrome, "exit");
  }
  server.close();
  await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function renderPage() {
  return String.raw`<!doctype html><canvas width="640" height="360"></canvas><script>
const canvas = document.querySelector('canvas');
const context = canvas.getContext('2d');
const scenes = [['empty-room', 0], ['one-person', 1], ['three-people', 3]];

(async () => {
  for (const [name, people] of scenes) await record(name, people);
  window.close();
})().catch(error => document.body.textContent = String(error?.stack ?? error));

async function record(name, people) {
  const stream = canvas.captureStream(20);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 450000 });
  const chunks = [];
  recorder.ondataavailable = event => chunks.push(event.data);
  recorder.start();
  const started = performance.now();
  while (performance.now() - started < 2500) {
    draw(people, (performance.now() - started) / 1000);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const stopped = new Promise(resolve => recorder.onstop = resolve);
  recorder.stop();
  await stopped;
  await fetch('/upload/' + name, { method: 'POST', body: new Blob(chunks, { type: recorder.mimeType }) });
  stream.getTracks().forEach(track => track.stop());
}

function draw(people, seconds) {
  const gradient = context.createLinearGradient(0, 0, 0, 360);
  gradient.addColorStop(0, '#6e767c');
  gradient.addColorStop(1, '#34383b');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 640, 360);
  context.fillStyle = '#77716b';
  context.fillRect(0, 285, 640, 75);
  context.fillStyle = '#222';
  context.fillRect(65, 70, 125, 160);
  context.fillRect(460, 50, 105, 180);
  context.fillStyle = 'rgba(255,255,230,.18)';
  context.beginPath(); context.arc(320, 0, 145, 0, Math.PI * 2); context.fill();
  const positions = people === 1 ? [320] : [230, 320, 410];
  positions.slice(0, people).forEach((x, index) => person(x, 190 + Math.sin(seconds * 2 + index) * 4, index));
  context.fillStyle = 'rgba(0,0,0,.7)';
  context.font = '20px sans-serif';
  context.fillText(people === 0 ? 'EMPTY ROOM' : people + (people === 1 ? ' PERSON' : ' PEOPLE'), 18, 334);
}

function person(x, y, index) {
  const colors = ['#426b91', '#795548', '#556b2f'];
  context.fillStyle = '#b98f72';
  context.beginPath(); context.arc(x, y - 70, 27, 0, Math.PI * 2); context.fill();
  context.fillStyle = colors[index];
  context.beginPath();
  context.roundRect(x - 44, y - 40, 88, 130, 24);
  context.fill();
}
</script>`;
}
