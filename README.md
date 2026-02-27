# NextText Backend

Backend API for the NextText iOS keyboard extension.

## Endpoints

- `GET /health`
- `POST /v1/nexttext/generate`

### Generate request body

```json
{
  "mode": "reply",
  "input": "hey you free tonight?",
  "vibe": "Flirty",
  "styleInstructions": "Keep replies short.",
  "forceRefresh": false
}
```

`mode` supports:
- `reply`
- `opener`

### Generate response body

```json
{
  "mode": "reply",
  "items": ["...", "...", "...", "..."],
  "replies": ["...", "...", "...", "..."],
  "meta": {
    "model": "gpt-4o-mini",
    "forceRefresh": false
  }
}
```

For opener mode, response also includes `openers`.

## Local run

1. Copy `.env.example` to `.env`
2. Set `OPENAI_API_KEY`
3. Install and run:

```bash
npm install
npm run dev
```

## Railway deploy

1. Push this repo to GitHub.
2. In Railway, create project from this repository.
3. Add variables:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (optional, default is `gpt-4o-mini`)
   - `MOCK_RESPONSES` (optional; set `true` only for temporary non-OpenAI testing)
4. Deploy.
5. Generate public domain in Railway Networking settings.

## iOS wiring

In NextText iOS project `Secrets.xcconfig`:

```xcconfig
NEXTTEXT_API_HOST = your-service.up.railway.app
```
