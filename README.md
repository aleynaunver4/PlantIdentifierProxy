# Plant Identifier Proxy

Single Vercel serverless function that sits between the
[Plant Identifier](https://github.com/aleynaunver4/PlantIdentifier)
Flutter app and the vision model. This is the only place in the whole
project that touches the EachLabs API key.

## Why this is a separate service

The Flutter app ships as an Android APK, which can be decompiled — so
anything embedded in the client isn't actually secret. This proxy holds
the API key server-side, as a Vercel environment variable, and is the
only thing that talks to EachLabs. The app sends a photo, gets back
structured JSON, and never sees a key.

```
Flutter app  ──POST { image, mimeType }──▶  /api/identify  ──▶  EachLabs LLM Router
             ◀────── structured JSON ─────                ◀──── model response
```

## Endpoint

### `POST /api/identify`

**Request body**
```json
{
  "image": "<base64-encoded photo>",
  "mimeType": "image/jpeg"
}
```

**Response** — always `200`, even on upstream failure, so the app has
one code path to handle:
```json
{
  "status": "ok | low_confidence | not_a_plant | error",
  "common_name": "Snake Plant",
  "scientific_name": "Dracaena trifasciata",
  "confidence": 0.91,
  "toxic_to_pets": true,
  "water": "Every 2-3 weeks, let soil dry fully",
  "light": "Low to bright indirect",
  "soil": "Well-draining cactus mix",
  "tip": "Most common killer: overwatering."
}
```

`status` is the field the client actually branches on:

| status | meaning |
|---|---|
| `ok` | confident identification |
| `low_confidence` | model wasn't sure enough (true confidence < 0.6) — client asks for a closer photo instead of guessing |
| `not_a_plant` | no plant detected in the image |
| `error` | upstream failure, bad request, or unparseable model output |

## How it works

1. Validates the request and reads `EACH_API_KEY` from the environment
   (fails closed with `status: "error"` if missing).
2. Sends the image as a data URL to EachLabs' OpenAI-compatible
   `chat/completions` endpoint, with a fixed prompt that pins the exact
   JSON schema and asks the model not to default to high confidence.
3. Parses the model's response defensively — direct JSON parse first,
   then a regex fallback for a stray code fence — and normalizes it
   against the schema before returning it.

The model is overridable via the `MODEL` env var (defaults to
`openai/gpt-4.1-mini`) so the identification model can be changed
without redeploying the Flutter app. See the [model selection
writeup](https://github.com/aleynaunver4/PlantIdentifier/blob/main/CONTEXT.md)
for why this model was chosen.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `EACH_API_KEY` | yes | EachLabs API key. Never committed — set via `vercel env add`. |
| `MODEL` | no | Overrides the default identification model. |

## Local development

```bash
npm install -g vercel
vercel dev
```

## Deploy

```bash
vercel --prod
vercel env add EACH_API_KEY production
vercel --prod   # redeploy so the function picks up the env var
```
