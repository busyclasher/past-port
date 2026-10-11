import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.APP_ORIGIN = "http://pastport.test";
process.env.SESSION_SECRET = "test-only-secret-with-at-least-32-characters";
process.env.ELEVENLABS_API_KEY = "test-key-never-sent-to-client";

const { app } = await import(`../server.mjs?configured=${Date.now()}`);
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test("serves the existing app with a protected session cookie and browser policy", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /pastport_voice_session=.*HttpOnly.*SameSite=Strict/i);
  assert.match(response.headers.get("permissions-policy"), /microphone=\(self\)/);
  assert.match(response.headers.get("content-security-policy"), /wss:\/\/api\.elevenlabs\.io/);
  assert.match(await response.text(), /Speak my memory/);
});

test("serves the comparison and booklet interaction assets", async () => {
  const [css, script] = await Promise.all([
    fetch(`${base}/demo-interactions.css`),
    fetch(`${base}/demo-interactions.js`),
  ]);
  assert.equal(css.status, 200);
  assert.equal(script.status, 200);
  assert.match(await css.text(), /compare-frame/);
  assert.match(await script.text(), /addComparison/);
});

test("serves each bundled landmark photograph and rejects other photo paths", async () => {
  for (const name of ["central-2006.jpg", "central-2022.jpg", "playground-2013.jpg", "playground-2025.jpg", "park-2006.jpg", "park-2011.jpg"]) {
    const response = await fetch(`${base}/photos/${name}`);
    assert.equal(response.status, 200, name);
    assert.match(response.headers.get("content-type"), /^image\/jpeg/);
    assert.ok((await response.arrayBuffer()).byteLength > 10_000);
  }
  assert.equal((await fetch(`${base}/photos/unverified.jpg`)).status, 404);
});

test("reports speech availability without exposing configuration", async () => {
  const response = await fetch(`${base}/api/speech-availability`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available: true });
});

test("rejects cross-origin token requests before contacting ElevenLabs", async () => {
  const response = await fetch(`${base}/api/scribe-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ purpose: "pastport-memory" }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "origin_not_allowed" });
});

test("requires a valid signed session before issuing a token", async () => {
  const response = await fetch(`${base}/api/scribe-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://pastport.test" },
    body: JSON.stringify({ purpose: "pastport-memory" }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_session" });
});

test("client assets contain no API key or credential header", async () => {
  const html = await (await fetch(`${base}/`)).text();
  const client = await (await fetch(`${base}/dist/speech-memory.js`)).text();
  assert.doesNotMatch(html, /ELEVENLABS_API_KEY|xi-api-key/i);
  assert.doesNotMatch(client, /ELEVENLABS_API_KEY|xi-api-key|test-key-never-sent-to-client/i);
});
