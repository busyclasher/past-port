import { CommitStrategy, RealtimeEvents, Scribe } from "@elevenlabs/client";

const MAX_SECONDS = 60;
const MAX_CHARACTERS = 600;
let active = null;

const messageForError = error => {
  const type = error?.message_type || error?.name || "";
  const detail = String(error?.message || error?.error || "").toLowerCase();
  if (type === "NotAllowedError" || detail.includes("permission") || detail.includes("notallowed")) return "Microphone permission was denied. You can still type your reflection.";
  if (type === "NotFoundError" || detail.includes("device") || detail.includes("microphone")) return "No microphone was found. You can still type your reflection.";
  if (["quota_exceeded", "rate_limited", "resource_exhausted"].includes(type)) return "The transcription service limit was reached. Please type your reflection or try again later.";
  if (type === "auth_error") return "Transcription could not be authorized. You can still type your reflection.";
  return "Transcription was interrupted. Your existing reflection is unchanged, and you can continue typing.";
};

function panelFor(element) {
  return element.closest("[data-speech-memory]");
}

function announce(panel, text) {
  const status = panel?.querySelector("[data-speech-status]");
  if (status) status.textContent = text;
}

function setPanelState(panel, state) {
  panel.dataset.speechState = state;
  for (const section of panel.querySelectorAll("[data-speech-view]")) section.hidden = section.dataset.speechView !== state;
}

function stopClock(session) {
  clearInterval(session.clockTimer);
  clearTimeout(session.limitTimer);
  clearTimeout(session.finalizeTimer);
}

function transcriptText(session) {
  return session.committed.join(" ").replace(/\s+/g, " ").trim();
}

function cleanupConnection(session) {
  if (!session) return;
  stopClock(session);
  try { session.connection?.close(); } catch {}
  session.connection = null;
}

function showError(session, message) {
  cleanupConnection(session);
  if (session.panel?.isConnected) {
    setPanelState(session.panel, "error");
    announce(session.panel, message);
  }
  if (active === session) active = null;
}

function finishReview(session) {
  const text = transcriptText(session);
  cleanupConnection(session);
  if (!session.panel?.isConnected) {
    if (active === session) active = null;
    return;
  }
  if (!text) {
    showError(session, "No speech was detected. Try again or type your reflection instead.");
    return;
  }
  setPanelState(session.panel, "review");
  const editor = session.panel.querySelector("[data-speech-review]");
  editor.value = text;
  updateReview(session.panel);
  announce(session.panel, "Transcription ready. Review and edit the words before saving.");
  editor.focus();
  active = session;
}

function finalize(session, reason = "stop") {
  if (!session || !["connecting", "recording"].includes(session.state)) return;
  session.state = "finalizing";
  setPanelState(session.panel, "finalizing");
  announce(session.panel, reason === "limit" ? "The 60 second limit was reached. Finishing your transcription…" : reason === "background" ? "Recording ended because PastPort moved to the background. Finishing your transcription…" : "Recording stopped. Finishing your transcription…");
  try { session.connection?.mute(); } catch {}
  session.finalizeTimer = setTimeout(() => {
    if (transcriptText(session)) finishReview(session);
    else showError(session, session.partial ? "The final transcript did not arrive. Please try again or type your reflection." : "No speech was detected. Try again or type your reflection instead.");
  }, 3_500);
}

function cancel(session, message = "Recording discarded. Your existing reflection is unchanged.") {
  if (!session) return;
  cleanupConnection(session);
  if (session.panel?.isConnected) {
    setPanelState(session.panel, "notice");
    announce(session.panel, message);
  }
  if (active === session) active = null;
}

function renderLive(session) {
  if (!session.panel?.isConnected) return cancel(session);
  const live = session.panel.querySelector("[data-speech-live]");
  const combined = [transcriptText(session), session.partial].filter(Boolean).join(" ").trim();
  live.textContent = combined || "Listening…";
}

async function fetchToken() {
  let response;
  try {
    response = await fetch("/api/scribe-token", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "pastport-memory" }),
    });
  } catch {
    throw new Error("network");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || "token_failure");
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  if (!payload.token) throw new Error("token_failure");
  return payload.token;
}

const speechRuntime = globalThis.PastPortSpeechRuntime || {
  fetchToken,
  connect: options => Scribe.connect(options),
};

async function start(panel) {
  if (active) cancel(active, "Previous recording discarded.");
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.WebSocket || !(window.AudioContext || window.webkitAudioContext)) {
    const session = { panel };
    showError(session, "Live transcription is not supported in this browser or context. You can still type your reflection.");
    return;
  }

  const session = { panel, placeId: panel.dataset.speechPlace, state: "connecting", committed: [], partial: "", elapsed: 0, connection: null };
  active = session;
  setPanelState(panel, "connecting");
  announce(panel, "Preparing secure transcription… Microphone permission will be requested next.");

  let token;
  try {
    token = await speechRuntime.fetchToken();
  } catch (error) {
    const message = error.status === 503 ? "Speech transcription is not configured right now. You can still type your reflection." : error.status === 429 ? "Too many recording sessions were requested. Please type your reflection or try again later." : "Could not start transcription. Check your connection or type your reflection instead.";
    showError(session, message);
    return;
  }
  if (active !== session || !panel.isConnected) return cancel(session);

  try {
    const connection = speechRuntime.connect({
      token,
      modelId: "scribe_v2_realtime",
      languageCode: "eng",
      commitStrategy: CommitStrategy.VAD,
      vadSilenceThresholdSecs: 1,
      vadThreshold: 0.4,
      minSpeechDurationMs: 100,
      minSilenceDurationMs: 100,
      noVerbatim: false,
      microphone: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        workletPaths: { scribeAudioProcessor: "/vendor/scribe-audio-processor.js" },
      },
    });
    session.connection = connection;

    connection.on(RealtimeEvents.SESSION_STARTED, () => {
      if (active !== session) return cleanupConnection(session);
      session.state = "recording";
      session.startedAt = Date.now();
      setPanelState(panel, "recording");
      announce(panel, "Recording. Tap Stop when you are finished. Maximum 60 seconds.");
      session.clockTimer = setInterval(() => {
        session.elapsed = Math.min(MAX_SECONDS, Math.floor((Date.now() - session.startedAt) / 1000));
        const clock = panel.querySelector("[data-speech-elapsed]");
        if (clock) clock.textContent = `${session.elapsed} / ${MAX_SECONDS} seconds`;
      }, 250);
      session.limitTimer = setTimeout(() => finalize(session, "limit"), MAX_SECONDS * 1000);
    });
    connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, data => {
      session.partial = data.text || "";
      renderLive(session);
    });
    connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, data => {
      const text = (data.text || "").trim();
      if (text) session.committed.push(text);
      session.partial = "";
      renderLive(session);
      if (session.state === "finalizing") setTimeout(() => finishReview(session), 150);
    });
    connection.on(RealtimeEvents.ERROR, error => showError(session, messageForError(error)));
    connection.on(RealtimeEvents.CLOSE, () => {
      if (active === session && ["connecting", "recording"].includes(session.state)) showError(session, "The transcription connection closed. Your existing reflection is unchanged, and you can continue typing.");
    });
  } catch (error) {
    showError(session, messageForError(error));
  }
}

function updateReview(panel) {
  const editor = panel.querySelector("[data-speech-review]");
  const count = panel.querySelector("[data-speech-review-count]");
  const save = panel.querySelector("[data-speech-save]");
  const length = editor.value.length;
  count.textContent = `${length} / ${MAX_CHARACTERS} characters`;
  count.classList.toggle("over-limit", length > MAX_CHARACTERS);
  save.disabled = !editor.value.trim() || length > MAX_CHARACTERS;
  const guidance = panel.querySelector("[data-speech-guidance]");
  guidance.textContent = length > MAX_CHARACTERS ? "Please shorten the transcription to 600 characters before saving." : "Edit anything the transcription did not capture correctly.";
}

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  const panel = panelFor(button);
  if (button.matches("[data-speech-open]")) {
    setPanelState(panel, "notice");
    announce(panel, "Review the privacy notice, then choose Start recording.");
  } else if (button.matches("[data-speech-start]")) {
    start(panel);
  } else if (button.matches("[data-speech-stop]")) {
    finalize(active);
  } else if (button.matches("[data-speech-cancel]")) {
    cancel(active || { panel });
  } else if (button.matches("[data-speech-retry]")) {
    setPanelState(panel, "notice");
    announce(panel, "Ready when you are. Starting again creates a new transcription session.");
  } else if (button.matches("[data-speech-discard]")) {
    cancel(active || { panel }, "Transcription discarded. Your existing reflection is unchanged.");
  } else if (button.matches("[data-speech-save]")) {
    const transcript = panel.querySelector("[data-speech-review]").value;
    const reflection = document.querySelector("#reflection-note");
    if (!reflection || !transcript.trim() || transcript.length > MAX_CHARACTERS) return;
    if (reflection.value.trim() && reflection.value !== transcript && !confirm("Replace your existing reflection with this transcription?")) return;
    reflection.value = transcript;
    reflection.dispatchEvent(new Event("input", { bubbles: true }));
    cleanupConnection(active);
    active = null;
    document.querySelector(`[data-save-reflection="${CSS.escape(panel.dataset.speechPlace)}"]`)?.click();
  }
});

document.addEventListener("input", event => {
  if (event.target.matches("[data-speech-review]")) updateReview(panelFor(event.target));
});

new MutationObserver(() => {
  if (active?.panel && !active.panel.isConnected) cancel(active);
}).observe(document.getElementById("app"), { childList: true, subtree: true });

document.addEventListener("visibilitychange", () => {
  if (document.hidden && active && ["connecting", "recording"].includes(active.state)) {
    if (transcriptText(active)) finishReview(active);
    else cancel(active, "Recording ended because PastPort moved to the background. No reflection was saved.");
  }
});
window.addEventListener("pagehide", () => {
  if (active) {
    cleanupConnection(active);
    active = null;
  }
});
