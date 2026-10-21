# YT Bot — Script to Stock Footage

A local web app that turns a video narration script into a visual shot list,
previews matching Pexels footage and photos, and packages the assets in a ZIP.
OpenAI extracts the visual search queries; Pexels supplies the stock media.

## Setup

You need Node.js 22 or newer, npm, and API keys for
[OpenAI](https://platform.openai.com/api-keys) and
[Pexels](https://www.pexels.com/api/).

1. Open a terminal in the project directory and install the dependencies:

   ```sh
   npm ci
   ```

2. Create or update `.env` in the project root with your API keys:

   ```dotenv
   OPENAI_API_KEY=your_openai_api_key
   PEXELS_API_KEY=your_pexels_api_key

   # Optional settings; defaults shown below
   OPENAI_MODEL=gpt-4o
   PORT=3000
   ```

   The server loads the keys from `.env`, which is ignored by Git.
   API usage is subject to each provider's account limits and billing.

3. Start the server:

   ```sh
   node server.js
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.
   If you changed `PORT`, use that port in the URL. Restart the server after
   changing `.env`.

## Usage

1. Paste a narration script of at least 20 characters.
2. Click **Generate preview**. OpenAI extracts visual search queries from the
   script, including any `[VISUAL: ...]` notes. The current extraction prompt
   is tailored to true-crime narration.
3. Review the thumbnails. Each shot shows up to three landscape video matches.
   Pexels photos are used when the video search returns no results.
4. Click **Download all** to save `stock-footage.zip` with all returned options.

Preview generation searches for media without downloading the full files.
The download step uses the previewed results and streams the ZIP to your browser.
The root `shotlist.json` contains example shot descriptions; the web app generates
its own list from your script.

## ZIP contents

The archive contains the generated `shotlist.json` and numbered folders for each
shot. Media options use `.mp4` for videos and `.jpg` for photos:

```text
stock-footage.zip
├── shotlist.json
├── 01-empty-road-at-night/
│   ├── option-1.mp4
│   ├── option-2.mp4
│   └── option-3.mp4
├── 02-dinner-table-empty-chair/
│   └── NEEDS_AI_GENERATION.txt
└── NEEDS_AI_GENERATION_SUMMARY.txt
```

Shots with no stock results receive `NEEDS_AI_GENERATION.txt` containing the
description to use as a generation prompt. The summary file is included only
when at least one shot needs AI generation. These shots currently require manual
generation with a provider such as Leonardo or Flux/Replicate.

## Limits and troubleshooting

- Each IP address can make five preview requests and five download requests
  per one-hour window. The two limits are tracked separately; exceeding either
  returns HTTP 429.
- JSON request bodies are limited to 2 MB. Stock searches run one shot at a time,
  so larger scripts take longer and consume more Pexels API requests.
- If extraction fails, check the server terminal and your OpenAI key, configured
  model, and account access.
- Pexels search failures can currently appear as shots needing AI generation.
  Check the server terminal and your Pexels key or quota when this happens
  unexpectedly.
- Failed media downloads are logged in the server terminal and skipped in the
  ZIP, so an archive can contain fewer options than the preview.

## Remaining work

- Automatically generate media for shots without stock matches.
- Add stricter validation of scripts, generated shot lists, and download payloads,
  plus startup checks for required API keys.
- Add request timeouts and retries, distinguish provider errors from empty search
  results, and report missing downloads to the user.
