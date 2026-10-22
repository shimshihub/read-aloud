const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage({ ...msg, target: "background" });
let status = "idle";

const mac = /Mac/.test(navigator.platform);
$("hint").textContent = `Right-click selected text → Read aloud · ${mac ? "⌥⇧R" : "Alt+Shift+R"} read · ${mac ? "⌥⇧S" : "Alt+Shift+S"} stop`;

chrome.storage.sync.get(["voice", "speed"]).then(({ voice = "af_heart", speed = 1 }) => {
  $("voice").value = voice;
  $("speed").value = speed;
  $("speedLabel").textContent = `${Number(speed).toFixed(1)}×`;
});
chrome.storage.session.get("state").then(({ state }) => state && render(state));
chrome.storage.session.onChanged.addListener((c) => c.state && render(c.state.newValue));

// Warm the model up as soon as the popup opens, so the first read is faster.
send({ type: "preload" });

$("voice").onchange = (e) => chrome.storage.sync.set({ voice: e.target.value });
$("speed").oninput = (e) => {
  $("speedLabel").textContent = `${Number(e.target.value).toFixed(1)}×`;
  chrome.storage.sync.set({ speed: Number(e.target.value) });
};
$("stop").onclick = () => send({ type: "stop" });
$("play").onclick = async () => {
  if (status === "speaking") return send({ type: "pause" });
  if (status === "paused") return send({ type: "resume" });
  const res = await send({ type: "read-selection" });
  if (!res?.ok) render({ status: "idle", detail: "Select some text on the page first" });
};

function render({ status: s, detail }) {
  status = s;
  $("status").textContent = detail || { idle: "Ready", speaking: "Speaking", paused: "Paused", loading: "Loading…" }[s] || "";
  $("status").className = s === "error" ? "error" : "";
  $("play").textContent = s === "speaking" ? "❚❚ Pause" : s === "paused" ? "▶ Resume" : "▶ Read selection";
}
