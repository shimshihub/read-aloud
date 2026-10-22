// Service worker: entry points (context menu, shortcuts, popup) -> offscreen document,
// which does the actual Kokoro inference and audio playback.
const DEFAULTS = { voice: "af_heart", speed: 1.0 };

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.create({ id: "read-aloud", title: "Read aloud", contexts: ["selection"] });
  if (reason === "install") chrome.tabs.create({ url: "welcome.html" });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "read-aloud" && info.selectionText) speak(info.selectionText);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "stop") return sendToOffscreen({ type: "stop" });
  if (command === "read-selection") {
    const text = await getSelectionFromActiveTab();
    if (text) speak(text);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "background") return;
  if (msg.type === "state") {
    setState(msg.state);
  } else if (msg.type === "read-selection") {
    getSelectionFromActiveTab().then((text) => {
      if (text) speak(text);
      sendResponse({ ok: !!text });
    });
    return true;
  } else if (["stop", "pause", "resume"].includes(msg.type)) {
    sendToOffscreen({ type: msg.type });
  } else if (msg.type === "preload") {
    ensureOffscreen().then(() => sendToOffscreen({ type: "preload" }));
  }
});

async function getSelectionFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return "";
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => getSelection().toString(),
    });
    return results.map((r) => r.result || "").find((t) => t.trim()) || "";
  } catch (e) {
    console.warn("Could not read selection (restricted page?)", e);
    return "";
  }
}

async function speak(text) {
  const settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(["voice", "speed"])) };
  await ensureOffscreen();
  sendToOffscreen({ type: "speak", text, voice: settings.voice, speed: Number(settings.speed) });
}

let creating;
async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (existing.length) return;
  creating ??= chrome.offscreen.createDocument({
    url: "offscreen.html",
    // Brave closes offscreen docs after 30s of silence whatever the reason, so offscreen.js
    // plays an inaudible keepalive tone while it is busy.
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Run the Kokoro TTS model and play the generated speech",
  });
  await creating;
  creating = null;
}

function sendToOffscreen(msg) {
  return chrome.runtime.sendMessage({ ...msg, target: "offscreen" }).catch(() => {});
}

// Badge + cached state so the popup can show status when it opens.
const BADGES = { loading: ["…", "#888"], speaking: ["▶", "#2b4cff"], paused: ["❚❚", "#888"], error: ["!", "#d33"] };
function setState(state) {
  chrome.storage.session.set({ state });
  const [text, color] = BADGES[state.status] || ["", "#000"];
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}
