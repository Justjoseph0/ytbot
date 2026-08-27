# Stock Footage Fetcher

Reads a shot list and automatically pulls matching stock footage/photos
from Pexels for each shot, so you're not manually searching one by one.

## Setup

1. Get a free API key at https://www.pexels.com/api/ (instant, no cost)
2. Install dependencies (none needed — uses built-in Node modules only)

## Usage

```bash
PEXELS_API_KEY=your_key_here node fetch.js shotlist.json
```

`shotlist.json` is just an array of shot descriptions:

```json
[
  "dark empty road at night",
  "empty parked car airport lot",
  "dinner table with empty chair"
]
```

## What it does

- For each shot: searches Pexels videos first, falls back to photos if no video match
- Downloads the top 3 results into `output/<number>-<shot-name>/`
- Any shot with zero matches gets a `NEEDS_AI_GENERATION.txt` file instead —
  those are the ones to send to Leonardo/Flux manually (or wire in later
  once you pick an AI provider)

## Next steps (not built yet)

- Auto-send `NEEDS_AI_GENERATION.txt` shots to an AI generation API
  (Leonardo or Flux/Replicate) instead of flagging them manually
- Rate limit: Pexels free tier allows 200 requests/hour — fine for
  single-video shot lists (20-30 shots), but batch carefully if running
  this across multiple scripts back to back
