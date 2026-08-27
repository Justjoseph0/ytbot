#!/usr/bin/env node
/**
 * YT Bot — web server
 *
 * Flow:
 *   1. User pastes a script into the web page and clicks "Generate"
 *   2. Server sends the script to Claude, asking it to extract a
 *      clean list of visual shot descriptions (ignoring headers,
 *      timestamps, and dialogue-only lines)
 *   3. Server searches Pexels for each shot (video first, photo fallback)
 *   4. Server zips all downloaded files + a shotlist.json + a
 *      NEEDS_AI_GENERATION list, and sends the zip back for download
 *
 * Setup:
 *   - Start the server; users provide their own API keys in the browser
 *   - npm install
 *   - node server.js
 *   - open http://localhost:3000
 */

const path = require("path");
const express = require("express");
const archiver = require("archiver");

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const RESULTS_PER_SHOT = 3;
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

// ---- Step 1: extract shot list from script using Claude ----
async function extractShotsFromScript(scriptText, openAIKey) {
  const prompt = `You are given a video narration script for a true crime style YouTube video. It may contain section headers, timestamps, narration lines, and [VISUAL: ...] notes.

Extract a clean JSON array of short visual search queries (3-8 words each) suitable for searching stock video/photo libraries like Pexels. Base these on:
- Any explicit [VISUAL: ...] notes in the script
- The mood and content of the surrounding narration, where no visual note exists

Rules:
- Return ONLY a JSON array of strings, nothing else — no preamble, no markdown fences
- Each entry should be a generic, searchable visual description (e.g. "empty parked car airport lot at night"), not a direct quote from the script
- Avoid describing any specific real person's face — keep descriptions generic (silhouettes, objects, locations, wide shots)
- Aim for one shot per distinct visual beat, roughly one every 2-4 sentences of narration

Script:
${scriptText}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openAIKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const textResponse = data.choices?.[0]?.message?.content;
  if (!textResponse) throw new Error("No text response from OpenAI.");

  let cleaned = textResponse.trim();
  // strip markdown fences if present, just in case
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

  const shots = JSON.parse(cleaned);
  if (!Array.isArray(shots)) throw new Error("OpenAI did not return an array.");
  return shots;
}


// ---- Step 2: Pexels search/download ----
async function searchVideos(query, pexelsKey) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
    query
  )}&per_page=${RESULTS_PER_SHOT}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: pexelsKey } });
  const json = await res.json();
  return (json.videos || []).map((v) => {
    const files = v.video_files.sort((a, b) => (a.width || 0) - (b.width || 0));
    const pick = files.find((f) => f.width >= 1280) || files[files.length - 1];
    return {
      type: "video",
      previewUrl: v.image || pick.link,
      downloadUrl: pick.link,
      id: v.id,
    };
  });
}

async function searchPhotos(query, pexelsKey) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
    query
  )}&per_page=${RESULTS_PER_SHOT}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: pexelsKey } });
  const json = await res.json();
  return (json.photos || []).map((p) => ({
    type: "photo",
    previewUrl: p.src.medium || p.src.large,
    downloadUrl: p.src.large2x || p.src.large,
    id: p.id,
  }));
}

async function downloadToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Media download failed: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function findStockForShot(description, pexelsKey) {
  let results = [];
  try {
    results = await searchVideos(description, pexelsKey);
  } catch (e) {
    console.error(`video search failed for "${description}": ${e.message}`);
  }
  if (results.length === 0) {
    try {
      results = await searchPhotos(description, pexelsKey);
    } catch (e) {
      console.error(`photo search failed for "${description}": ${e.message}`);
    }
  }
  return results;
}

// ---- preview endpoint: extract shots and search without downloading ----
app.post("/api/preview", async (req, res) => {
  const { script, openaiKey, pexelsKey } = req.body;
  if (!openaiKey) return res.status(400).json({ error: "Missing OpenAI API key." });
  if (!pexelsKey) return res.status(400).json({ error: "Missing Pexels API key." });
  if (!script || script.trim().length < 20) {
    return res.status(400).json({ error: "Script is too short or missing." });
  }

  try {
    console.log("Extracting shot list from script...");
    const shots = await extractShotsFromScript(script, openaiKey);
    console.log(`Got ${shots.length} shots. Fetching stock media...`);

    const previewShots = [];
    for (const description of shots) {
      const results = await findStockForShot(description, pexelsKey);
      previewShots.push({ description, results, needsAI: results.length === 0 });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    res.json({ shots: previewShots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---- download endpoint: zip the already-previewed stock results ----
app.post("/api/download", async (req, res) => {
  const { shots, openaiKey, pexelsKey } = req.body;
  if (!openaiKey) return res.status(400).json({ error: "Missing OpenAI API key." });
  if (!pexelsKey) return res.status(400).json({ error: "Missing Pexels API key." });
  if (!Array.isArray(shots) || shots.length === 0) {
    return res.status(400).json({ error: "No previewed shots supplied." });
  }

  try {

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=stock-footage.zip");

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    archive.append(JSON.stringify(shots.map((shot) => shot.description), null, 2), {
      name: "shotlist.json",
    });

    const needsAI = [];

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i] || {};
      const description = String(shot.description || `shot ${i + 1}`);
      const shotNum = String(i + 1).padStart(2, "0");
      const folderName = `${shotNum}-${slugify(description)}`;

      const results = Array.isArray(shot.results) ? shot.results : [];

      if (shot.needsAI || results.length === 0) {
        needsAI.push(description);
        archive.append(
          `No stock results for: "${description}"\nUse this as an AI generation prompt instead.\n`,
          { name: `${folderName}/NEEDS_AI_GENERATION.txt` }
        );
        continue;
      }

      for (const [idx, item] of results.entries()) {
        if (!/^https:\/\/(images|videos)\.pexels\.com\//i.test(item.downloadUrl || "")) {
          console.error(`skipping invalid media URL for ${description} option ${idx + 1}`);
          continue;
        }
        const ext = item.type === "video" ? "mp4" : "jpg";
        try {
          const buffer = await downloadToBuffer(item.downloadUrl);
          archive.append(buffer, { name: `${folderName}/option-${idx + 1}.${ext}` });
        } catch (e) {
          console.error(`download failed for ${description} option ${idx + 1}: ${e.message}`);
        }
      }

    }

    if (needsAI.length > 0) {
      archive.append(needsAI.join("\n"), { name: "NEEDS_AI_GENERATION_SUMMARY.txt" });
    }

    await archive.finalize();
    console.log("Done, zip sent.");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`YT Bot running at http://localhost:${PORT}`);
});
