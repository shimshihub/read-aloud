// Offscreen document: loads Kokoro once, streams sentence-by-sentence audio into a queue.
import { KokoroTTS, TextSplitterStream, env as kokoroEnv } from "kokoro-js";
import { env } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

env.allowLocalModels = false;
env.useBrowserCache = true;
kokoroEnv.wasmPaths = chrome.runtime.getURL("ort/");

let ttsPromise;
let device = "";
const ctx = new AudioContext({ sampleRate: 24000 });
let job = 0;          // bumped on every new read / stop, so stale generations drop out
let sources = [];
let nextStart = 0;
let pending = 0;      // buffers scheduled but not finished playing
let generating = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "speak") speak(msg.text, msg.voice, msg.speed);
  else if (msg.type === "stop") stop();
  else if (msg.type === "pause") ctx.suspend().then(() => state("paused"));
  else if (msg.type === "resume") ctx.resume().then(() => state("speaking"));
  else if (msg.type === "preload") loadModel().catch(() => {});
});

// Brave closes this document after 30s without audible output, even mid-download. A 20Hz tone
// at -60dBFS counts as audio but can't be heard. It runs on its own context so pause doesn't stop
// it, and stays on for a while after the last read; then Brave closes the doc, freeing the model's
// memory (the next read reloads it from cache).
const KEEPALIVE_AFTER_IDLE_MS = 5 * 60 * 1000;
let keepaliveCtx;
let idleTimer;

function keepAlive(on) {
  if (on && !keepaliveCtx) {
    keepaliveCtx = new AudioContext();
    const osc = keepaliveCtx.createOscillator();
    const gain = keepaliveCtx.createGain();
    osc.frequency.value = 20;
    gain.gain.value = 0.001;
    osc.connect(gain).connect(keepaliveCtx.destination);
    osc.start();
  } else if (!on && keepaliveCtx) {
    keepaliveCtx.close();
    keepaliveCtx = null;
  }
}

function state(status, detail = "") {
  clearTimeout(idleTimer);
  keepAlive(true);
  if (status === "idle" || status === "error") idleTimer = setTimeout(() => keepAlive(false), KEEPALIVE_AFTER_IDLE_MS);
  chrome.runtime.sendMessage({ target: "background", type: "state", state: { status, detail, device } }).catch(() => {});
}

function progressCallback(p) {
  // Only the big .onnx file matters for a meaningful percentage.
  if (p.status === "progress" && p.file?.endsWith(".onnx")) {
    state("loading", `Downloading voice model ${Math.round(p.progress)}%`);
  }
}

function loadModel() {
  ttsPromise ??= (async () => {
    state("loading", "Loading voice model…");
    if (navigator.gpu && (await navigator.gpu.requestAdapter())) {
      try {
        const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "fp32", device: "webgpu", progress_callback: progressCallback });
        device = "WebGPU";
        console.log("Kokoro running on WebGPU");
        return tts;
      } catch (e) {
        console.warn("WebGPU load failed, falling back to wasm", e);
      }
    }
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "wasm", progress_callback: progressCallback });
    device = "WASM";
    console.log("Kokoro running on WASM (q8)");
    return tts;
  })();
  ttsPromise.catch((e) => {
    ttsPromise = null;
    state("error", `Model failed to load: ${e.message}`);
  });
  return ttsPromise;
}

function stop() {
  job++;
  for (const s of sources) {
    s.onended = null;
    try { s.stop(); } catch {}
  }
  sources = [];
  pending = 0;
  generating = false;
  if (ctx.state === "suspended") ctx.resume();
  state("idle", "Stopped");
}

async function speak(text, voice, speed) {
  stop();
  const myJob = job;
  const tts = await loadModel();
  if (myJob !== job) return;

  await ctx.resume();
  nextStart = ctx.currentTime + 0.05;
  generating = true;
  state("loading", "Preparing speech…");

  const splitter = new TextSplitterStream();
  splitter.push(text.replace(/\s+/g, " ").trim());
  splitter.close();

  try {
    for await (const { audio } of tts.stream(splitter, { voice, speed })) {
      if (myJob !== job) return;
      enqueue(audio.audio, audio.sampling_rate, myJob);
    }
  } catch (e) {
    if (myJob === job) state("error", `Speech failed: ${e.message}`);
    return;
  }
  if (myJob !== job) return;
  generating = false;
  if (pending === 0) state("idle", "Done");
}

function enqueue(samples, rate, myJob) {
  const buffer = ctx.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  const when = Math.max(nextStart, ctx.currentTime);
  src.start(when);
  nextStart = when + buffer.duration;
  sources.push(src);
  pending++;
  if (ctx.state !== "suspended") state("speaking", device ? `Speaking · ${device}` : "Speaking");
  src.onended = () => {
    if (myJob !== job) return;
    sources = sources.filter((s) => s !== src);
    pending--;
    if (pending === 0 && !generating) state("idle", "Done");
  };
}
