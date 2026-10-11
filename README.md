# PastPort

Interactive neighbourhood-memory prototype with local stamp and reflection persistence.

Live Vercel deployment: [https://past-port-ten.vercel.app](https://past-port-ten.vercel.app). The production alias was confirmed reachable without Vercel sign-in on 11 October 2026. The current deployment was uploaded from this local workspace; commit and push these source files before relying on Git-triggered redeployments.

## Live demo route

Start the app as below and open [http://localhost:4173](http://localhost:4173). For the quickest reliable route, choose **Let’s explore**, then **Toa Payoh Central**. A landmark card or map pin opens its story. Drag the photograph divider (or use its arrow keys), open **Memories**, type and save a reflection, collect the stamp, open **My PastPort**, and use **Revisit this landmark**. Each comparison uses two dated photographs of the named place, taken from different viewpoints. It is not a matched before-and-after reconstruction.

For a clean run, open a fresh private browser window. To reset only PastPort's demo data in an existing browser, run this in that page's developer console and refresh:

```js
localStorage.removeItem('pastport.collection.v1');
localStorage.removeItem('pastport.reflections.v1');
location.reload();
```

This leaves unrelated browser storage untouched. If the illustrated map does not display, use the landmark list immediately below it, or open `http://localhost:4173/#place/central`. If page animation is unavailable or reduced motion is enabled, Previous and Next still change pages without motion.

The illustrated map, supplied interactive scenes, and quoted resident-style recollections remain labelled demo content. Landmark cards, story comparisons, detail heroes, and booklet pages use real, source-credited photographs. Personal reflections are labelled **Your reflection**, stored locally when possible, and are not presented as historical evidence. Live ElevenLabs transcription is optional and is unavailable unless the server is configured with credentials; typing is always available.

### Landmark photograph credits

Images are bundled locally at reduced resolution and cropped by the interface for display. The six source photographs and reuse terms are:

- Toa Payoh Central: [2006 · Terence Ong · CC BY 2.5](https://commons.wikimedia.org/wiki/File:Toa_Payoh_Central.JPG); [2022 · Wzhkevin · CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Outdoor_shopping_mall_in_Toa_Payoh_Central_-_2022-04-16.jpg).
- Toa Payoh Dragon Playground: [2013 · Jimmy Tan · CC BY 2.0](https://commons.wikimedia.org/wiki/File:Dragon_playground_in_front_of_Block_28_Toa_Payoh_Lorong_6.jpg); [2025 · Chainwit. · CC BY 4.0](https://commons.wikimedia.org/wiki/File:Original_%22Toa_Payoh_Dragon_Playground%22,_Singapore_(2025)_-_img_01.jpg).
- Toa Payoh Town Park: [2006 · User:Sengkang · copyrighted free use](https://commons.wikimedia.org/wiki/File:Toa_Payoh_Town_Park_11,_Aug_06.JPG); [2011 · XW Chong · CC BY-SA 3.0](https://commons.wikimedia.org/wiki/File:TPY_town_park.jpg).

## Run locally

PastPort’s normal typed-reflection journey still works when the speech service is not configured.

```sh
npm install
npm start
```

Open `http://localhost:4173`. The start command builds the browser bundle and starts the minimal same-origin server.

## Deploy to Vercel

The existing Express app is the Vercel entry point; `vercel.json` bundles the HTML and browser assets with it. Run `npm run build` and `npm run check` before deployment, then link and deploy with the Vercel CLI:

```sh
npx vercel@latest login
npx vercel@latest link
npx vercel@latest deploy
```

Check the CLI output: a new project's first deployment may receive its production URL; later plain `deploy` commands create previews. Verify `/`, `/demo-interactions.css`, `/demo-interactions.js`, all six `/photos/*.jpg` assets, `/dist/speech-memory.js`, and `/api/speech-availability` before sharing the URL. If Vercel Authentication protects the project, sign in or use `vercel curl` to inspect it; do not disable protection without deciding to make the demo public. A deployment without ElevenLabs secrets keeps manual reflections working and clearly marks voice transcription unavailable. Do not add `ELEVENLABS_API_KEY` or `SESSION_SECRET` to client assets or `vercel.json`.

If voice is enabled later, set `ELEVENLABS_API_KEY`, a strong `SESSION_SECRET`, and the exact deployment origin in `APP_ORIGIN` using Vercel's server-side environment settings. The current in-memory voice rate limits are per function instance; use a shared rate-limit store before enabling voice for a public, high-traffic deployment.

## Enable “Speak my memory”

Copy `.env.example` into your deployment’s secret configuration and set:

- `ELEVENLABS_API_KEY`: server-side ElevenLabs key. Never prefix it with `PUBLIC_` or expose it to browser assets.
- `SESSION_SECRET`: at least 32 random characters used to sign the short-lived, HttpOnly session cookie.
- `APP_ORIGIN`: the exact public origin allowed to request tokens, such as `https://pastport.example`.
- `PORT`: optional; defaults to `4173`.

The sample server does not read `.env` files automatically. Inject secrets through the hosting platform or shell environment:

```sh
ELEVENLABS_API_KEY=... SESSION_SECRET=... APP_ORIGIN=http://localhost:4173 npm start
```

The browser fetches a new single-use `realtime_scribe` token for every recording and then connects directly to ElevenLabs with the official `@elevenlabs/client` SDK. The server never receives or stores microphone audio or transcripts.

The token endpoint is protected by exact-origin checks, a signed SameSite/HttpOnly session cookie, per-IP rate limits, a five-session-per-hour session allowance, and a ten-second session cooldown. For a multi-instance production deployment, move session usage and rate-limit state to a shared store.

## Speech behavior

- Model: `scribe_v2_realtime`
- Language: English (`eng`)
- Segmentation: voice activity detection (VAD)
- Maximum recording time: 60 seconds
- The transcript is never saved automatically. The user must review it and choose **Save reflection**.
- Raw audio is not retained by PastPort. Audio is sent directly to ElevenLabs for transcription; this project makes no claim about ElevenLabs retention outside the configured account and service policy.
- Existing typed text is not replaced without confirmation.
- Navigation, cancellation, backgrounding, and page exit close the active microphone connection.

Singaporean place names, accents, code-switching, and Singlish have not been formally evaluated in this prototype. Transcripts remain editable and the interface makes no reliability claim for regional dialects.

Implementation follows ElevenLabs’ current [client-side streaming guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming), [commit/VAD guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies), and [JavaScript SDK reference](https://elevenlabs.io/docs/eleven-api/resources/libraries/scribe-stt/javascript-scribe).

## Checks

```sh
npm run build
npm run check
```
