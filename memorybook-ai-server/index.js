// index.js - Local AI + Face proxy server for MemoryBook

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const util = require("util");

// 👉 import helpers that talk to Python face_api
const { detectFacesInList, registerFace, recognizeFace } = require("./face-service");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "20mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "ai server alive" });
});

// ---- Ollama config ----
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

// ✅ Better default text model for instruction-following (change anytime)
const OLLAMA_TEXT_MODEL =
  process.env.OLLAMA_TEXT_MODEL || "qwen2.5:7b-instruct"; // recommended
// If you want to keep DeepSeek:
// const OLLAMA_TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL || "deepseek-r1:7b";

const OLLAMA_VISION_MODEL =
  process.env.OLLAMA_VISION_MODEL || "llava-phi3:latest";

// -------------------------
// Small helpers
// -------------------------
function countWords(str) {
  return String(str || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function normalizeCaptionLength(caption, captionDraft) {
  let result = String(caption || captionDraft || "").trim();
  if (!result) return "";

  result = result.replace(/\s+/g, " ").trim();
  const words = countWords(result);

  const MAX_WORDS = 50;
  if (words <= MAX_WORDS) return result;

  const tokens = result.split(/\s+/);
  let truncated = tokens.slice(0, MAX_WORDS).join(" ");

  const punctuations = [".", "!", "?", "。", "！", "？"];
  let lastPuncIndex = -1;

  for (const p of punctuations) {
    const idx = truncated.lastIndexOf(p);
    if (idx > lastPuncIndex) lastPuncIndex = idx;
  }

  if (lastPuncIndex > 0) truncated = truncated.slice(0, lastPuncIndex + 1);
  return truncated.trim();
}

// ✅ Only pronoun enforcement (NO "young man/person" replacement)
function enforceFirstPerson(caption) {
  let result = String(caption || "");

  result = result.replace(/\b[Ss]he\b/g, "I");
  result = result.replace(/\b[Hh]e\b/g, "I");
  result = result.replace(/\b[Hh]im\b/g, "me");
  result = result.replace(/\b[Hh]er\b/g, "my");
  result = result.replace(/\bher\b/g, "my");

  return result.replace(/\s+/g, " ").trim();
}

// Extra guard: if no I/my/me at all, force a safe first-person rewrite
function forceUserPerspective(caption) {
  let result = String(caption || "").trim();
  if (!result) return result;

  const hasFirstPerson = /\b(i|me|my|mine|we|our|us)\b/i.test(result);
  if (hasFirstPerson) return enforceFirstPerson(result);

  // fallback short caption
  return "I’m saving this moment today.";
}

const ANIMAL_WORDS_FOR_PLUSH = [
  "dog",
  "dogs",
  "puppy",
  "puppies",
  "cat",
  "cats",
  "kitten",
  "kittens",
  "bear",
  "bears",
  "bunny",
  "bunnies",
  "rabbit",
  "rabbits",
];

function fixPlushAnimalHallucination(caption, captionDraft) {
  const draftLower = String(captionDraft || "").toLowerCase();
  if (!draftLower.includes("plush")) return caption;

  let result = String(caption || "");
  ANIMAL_WORDS_FOR_PLUSH.forEach((word) => {
    const re = new RegExp("\\b" + word + "\\b", "gi");
    result = result.replace(re, "plush toy");
  });
  return result;
}

const SENSITIVE_TAGS_REQUIRE_DRAFT = [
  "birthday",
  "cake",
  "cakes",
  "dessert",
  "desserts",
  "party",
  "celebration",
  "boh",
];

function adjustHashtags(hashtags, captionDraft) {
  let tags = Array.isArray(hashtags) ? [...hashtags] : [];

  tags = tags
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase().replace(/\s+/g, ""));

  tags = Array.from(new Set(tags));

  const draftLower = String(captionDraft || "").toLowerCase();
  tags = tags.filter((t) => {
    if (SENSITIVE_TAGS_REQUIRE_DRAFT.includes(t)) {
      return draftLower.includes(t);
    }
    return true;
  });

  const BANNED_ALWAYS = ["boh", "bohtea", "bohteamalaysia"];
  tags = tags.filter((t) => !BANNED_ALWAYS.includes(t));

  return tags.slice(0, 5);
}

const BANNED_BACKGROUND_WORDS = [
  "matches",
  "matchbox",
  "box of matches",
  "pencil",
  "pencils",
  "pen",
  "pens",
  "marker",
  "markers",
  "notebook",
  "notebooks",
  "remote control",
  "remote",
];

function removeBannedWords(text) {
  let result = String(text || "");
  for (const w of BANNED_BACKGROUND_WORDS) {
    const re = new RegExp("\\b" + w.replace(/\s+/g, "\\s+") + "\\b", "ig");
    result = result.replace(re, "");
  }
  return result.replace(/\s+/g, " ").trim();
}

const BANNED_ACTIVITY_PHRASES = [
  "taking notes",
  "take notes",
  "doing homework",
  "do homework",
  "studying",
  "study session",
  "working on my notes",
  "working on notes",
  "working on homework",
  "working on assignments",
  "doing my assignment",
  "doing assignments",
  "preparing for exams",
  "studying for exams",
];

function removeBannedActivities(text, captionDraft) {
  let result = String(text || "");
  const draftLower = String(captionDraft || "").toLowerCase();

  for (const phrase of BANNED_ACTIVITY_PHRASES) {
    if (!draftLower.includes(phrase.toLowerCase())) {
      const re = new RegExp(phrase.replace(/\s+/g, "\\s+"), "ig");
      result = result.replace(re, "");
    }
  }

  result = result.replace(/\s+/g, " ").trim();
  result = result.replace(/\s+,/g, ",").replace(/,\s*,/g, ",");
  return result.trim();
}

function removeBrandTextIfNotInDraft(text, captionDraft) {
  let result = String(text || "");
  const draftLower = String(captionDraft || "").toLowerCase();

  if (!draftLower.includes("boh")) {
    result = result.replace(/\bBOH\b/gi, "").trim();
  }
  return result.replace(/\s+/g, " ").trim();
}

function fallbackTagsFromDraft(captionDraft, max = 3) {
  const draft = String(captionDraft || "").trim();
  if (!draft) return [];

  const cleaned = draft
    .toLowerCase()
    .replace(/[#]/g, " ")
    .split(/[,;\n\r\t ]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .filter((t) => /^[a-z0-9]+$/i.test(t));

  return Array.from(new Set(cleaned)).slice(0, max);
}

// -------------------------
// Ollama helpers
// -------------------------
async function callOllamaChatText(prompt, modelOverride) {
  const model = modelOverride || OLLAMA_TEXT_MODEL;

  const resp = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model,
    messages: [{ role: "user", content: prompt }],
    format: "json",
    stream: false,
    options: {
      temperature: 0.2,
      top_p: 0.9,
      num_predict: 220,
    },
  });

  return resp.data?.message?.content || "";
}

// -------------------------
// Vision – single image describe
// -------------------------
async function describeSingleImage(imageBase64, index, total) {
  if (!imageBase64) return "";

  const body = {
    model: OLLAMA_VISION_MODEL,
    messages: [
      {
        role: "user",
        content: `
You are a very strict vision model. This is photo ${index} of ${total}.
Describe ONLY what you clearly see in this one photo.

FOCUS (VERY IMPORTANT):
- Focus on the main subject (people, landscapes, buildings, plush toys, large objects).
- Ignore tiny/unclear background items.
- If you are not 100% sure what an object is, DO NOT name it.
- If you see the word "BOH" anywhere, IGNORE it and do NOT mention it.

STRICT NO-GUESSING:
- Do NOT invent events, memories, seasons, emotions, stories.
- Do NOT guess text on far signs.

STYLE:
- Simple English, 1–2 short sentences.
`.trim(),
        images: [imageBase64],
      },
    ],
    stream: false,
  };

  const resp = await axios.post(`${OLLAMA_URL}/api/chat`, body);
  return String(resp.data?.message?.content || "").trim();
}

// -------------------------
// Vision – multi images describe
// -------------------------
async function callOllamaVisionDescribeMulti(imageBase64List) {
  const safeList = Array.isArray(imageBase64List)
    ? imageBase64List.filter(Boolean)
    : [];
  if (!safeList.length) return "";

  const total = safeList.length;
  const parts = [];

  for (let i = 0; i < total; i++) {
    try {
      const desc = await describeSingleImage(safeList[i], i + 1, total);
      if (desc) parts.push(`Photo ${i + 1}: ${desc}`);
    } catch (err) {
      console.log(`Vision describe error on photo ${i + 1}:`, err.message || err);
    }
  }

  if (!parts.length) return "";

  let combined = parts.join("\n");
  combined = combined.replace(/\bBOH\b/gi, "").replace(/\s+/g, " ").trim();

  console.log("[VISION] Combined per-photo description:\n", combined);
  return combined;
}

// -------------------------
// ✅ Face recognize batch
// -------------------------
async function recognizeFaceBatch(imageBase64List, threshold) {
  const safeList = Array.isArray(imageBase64List)
    ? imageBase64List.filter(Boolean)
    : [];
  const MAX_IMAGES = 6;
  const images = safeList.slice(0, MAX_IMAGES);

  const results = [];
  for (let i = 0; i < images.length; i++) {
    try {
      const pyResp = await recognizeFace(images[i], threshold);
      results.push({
        index: i,
        ok: pyResp.ok !== false,
        faces: Array.isArray(pyResp.faces) ? pyResp.faces : [],
      });
    } catch (e) {
      results.push({
        index: i,
        ok: false,
        faces: [],
        error: String(e?.message || e),
      });
    }
  }

  return { ok: true, count: images.length, results };
}

// -------------------------
// ✅ Grounding enforcement (keywords + retry)
// -------------------------
function buildMustKeywordsFromVision(visionDescription) {
  const v = String(visionDescription || "").toLowerCase();

  // add more if you want
  const pool = [
    "laptop",
    "keyboard",
    "desk",
    "table",
    "computer",
    "monitor",
    "phone",
    "mirror",
    "window",
    "glasses",
    "chair",
    "food",
    "drink",
    "coffee",
    "cat",
    "dog",
    "car",
  ];

  const must = pool.filter((k) => v.includes(k));
  return Array.from(new Set(must)).slice(0, 4);
}

function captionLooksUngrounded(caption, visionDescription, captionDraft, mustKeywords) {
  const c = String(caption || "").toLowerCase();
  const v = String(visionDescription || "").toLowerCase();
  const d = String(captionDraft || "").toLowerCase();

  // must be first person
  const hasFirstPerson = /\b(i|me|my|mine|we|our|us)\b/i.test(caption);
  if (!hasFirstPerson) return true;

  // must mention at least one must keyword (only if we have them)
  if (mustKeywords && mustKeywords.length) {
    const ok = mustKeywords.some((k) => c.includes(k));
    if (!ok) return true;
  }

  // avoid common fantasy words if not in vision/draft
  const fantasy = ["childhood", "summer", "winter", "nostalgia", "cherished", "memories of home"];
  for (const w of fantasy) {
    if (c.includes(w) && !v.includes(w) && !d.includes(w)) return true;
  }

  return false;
}

// -------------------------
// /ai/random-memory (unchanged)
// -------------------------
app.post("/ai/random-memory", async (req, res) => {
  try {
    const { groups = [] } = req.body || {};
    if (!Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ error: "groups must be a non-empty array" });
    }

    const trimmed = groups.slice(0, 80).map((g) => ({
      id: String(g.id || ""),
      postCount: Number(g.postCount || 0),
      sampleCaption: String(g.sampleCaption || "").slice(0, 120),
      hashtags: Array.isArray(g.hashtags) ? g.hashtags.slice(0, 8) : [],
      friendTags: Array.isArray(g.friendTags) ? g.friendTags.slice(0, 5) : [],
    }));

    const today = new Date().toISOString().slice(0, 10);

    const prompt = `
Return ONLY valid JSON:
{
  "selectedGroupId": "yyyy-mm-dd",
  "confidence": 0.0-1.0,
  "reason": "short reason"
}

Pick ONE group id for a "Random memory" feature.
Prefer postCount 2-15. Do NOT invent details.

Today = ${today}
groups = ${JSON.stringify(trimmed)}
`.trim();

    let raw = "";
    try {
      raw = await callOllamaChatText(prompt);
    } catch {
      raw = "";
    }

    let parsed = null;
    try {
      let cleaned = String(raw || "").trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```[a-zA-Z0-9]*\s*/, "");
        cleaned = cleaned.replace(/```$/, "").trim();
      }
      const first = cleaned.indexOf("{");
      const last = cleaned.lastIndexOf("}");
      if (first !== -1 && last !== -1) cleaned = cleaned.slice(first, last + 1);
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = null;
    }

    if (!parsed || !parsed.selectedGroupId) {
      const good = trimmed.filter((g) => g.postCount >= 2);
      const pickFrom = good.length ? good : trimmed;
      const idx = Math.floor(Math.random() * pickFrom.length);
      return res.json({
        selectedGroupId: pickFrom[idx].id,
        confidence: 0.35,
        reason: "Fallback selection (AI parse failed).",
      });
    }

    const selected = String(parsed.selectedGroupId);
    const exists = trimmed.some((g) => g.id === selected);
    if (!exists) {
      const idx = Math.floor(Math.random() * trimmed.length);
      return res.json({
        selectedGroupId: trimmed[idx].id,
        confidence: 0.35,
        reason: "Fallback selection (AI returned unknown id).",
      });
    }

    res.json({
      selectedGroupId: selected,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.6))),
      reason: String(parsed.reason || "Selected by AI."),
    });
  } catch (err) {
    console.error("❌ /ai/random-memory error:", err);
    res.status(500).json({ error: "Random memory AI failed" });
  }
});

// -------------------------
// /generatePostMeta
// -------------------------
app.post("/generatePostMeta", async (req, res) => {
  try {
    const { captionDraft = "", imageBase64List = [], imageBase64 = null } = req.body || {};

    const images =
      Array.isArray(imageBase64List) && imageBase64List.length > 0
        ? imageBase64List.filter(Boolean)
        : imageBase64
        ? [imageBase64]
        : [];

    console.log(
      "\n🧠 /generatePostMeta received. Images count:",
      images.length,
      "Draft:",
      captionDraft
    );

    // 1) Vision
    let visionDescription = "";
    if (images.length > 0) {
      try {
        visionDescription = await callOllamaVisionDescribeMulti(images);
        console.log("[VISION] Description from llava (multi):", visionDescription);
      } catch (err) {
        console.log("⚠️ Vision describe error, continue with text-only:", err.message || err);
      }
    }

    const mustKeywords = buildMustKeywordsFromVision(visionDescription);
    const mustLine =
      mustKeywords.length > 0
        ? `- The caption MUST mention at least ONE of these words: ${mustKeywords.join(", ")}.`
        : `- If vision is unclear, keep caption generic and simple.`;

    // 2) TEXT MODEL prompt (STRICT GROUNDED)
    const systemInstruction = `
You are an assistant for a personal memory / social media app.

Return ONLY valid JSON:
{
  "caption": "string",
  "hashtags": ["tag1","tag2"],
  "friendTags": ["name1","name2"]
}

STRICT GROUNDING RULES (MUST FOLLOW):
- You MUST base the caption ONLY on the vision description and the user's draft.
- Do NOT invent childhood, seasons, trips, celebrations, emotions, or stories unless clearly supported.
${mustLine}

STYLE RULES:
- Caption MUST be first-person ("I", "my", "me").
- Do NOT describe the user as "a man", "a woman", "a person", or "someone".
- 8–20 words, 0–2 emojis, no hashtags inside caption.

Hashtags:
- 1–5 tags, lowercase, no spaces, derived from visible objects only.

Friend tags:
- Do NOT invent names; return [] unless user typed names in draft.
`.trim();

    const combinedPrompt = `${systemInstruction}

User draft caption (may be empty):
"${captionDraft || "(empty)"}"

Vision description (may be empty):
"${visionDescription || "(no description)"}"
`;

    let rawContent = "";
    try {
      rawContent = await callOllamaChatText(combinedPrompt);
    } catch (err) {
      console.error("⚠️ Ollama text error in /generatePostMeta:", err.message || err);
      rawContent = JSON.stringify({ caption: captionDraft || "", hashtags: [], friendTags: [] });
    }

    // Parse JSON safely
    let parsed = { caption: captionDraft, hashtags: [], friendTags: [] };
    try {
      let cleanedStr = String(rawContent || "").trim();

      if (cleanedStr.startsWith("```")) {
        cleanedStr = cleanedStr.replace(/^```[a-zA-Z0-9]*\s*/, "");
        cleanedStr = cleanedStr.replace(/```$/, "").trim();
      }

      const firstBrace = cleanedStr.indexOf("{");
      const lastBrace = cleanedStr.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleanedStr = cleanedStr.slice(firstBrace, lastBrace + 1);
      }

      parsed = JSON.parse(cleanedStr);
    } catch (err) {
      console.log("⚠️ Failed to parse JSON from text model, fallback:", err);
      parsed = { caption: captionDraft, hashtags: [], friendTags: [] };
    }

    // ✅ Retry once if ungrounded / not first-person / missing keywords
    let captionTry = String(parsed.caption || captionDraft || "").trim();
    if (captionLooksUngrounded(captionTry, visionDescription, captionDraft, mustKeywords)) {
      const retryPrompt =
        combinedPrompt +
        `

Your previous JSON was NOT grounded enough.
Rewrite again. Follow the grounding rules strictly.
Return ONLY JSON.
`.trim();

      try {
        const retryRaw = await callOllamaChatText(retryPrompt);
        let cleanedRetry = String(retryRaw || "").trim();

        if (cleanedRetry.startsWith("```")) {
          cleanedRetry = cleanedRetry.replace(/^```[a-zA-Z0-9]*\s*/, "");
          cleanedRetry = cleanedRetry.replace(/```$/, "").trim();
        }

        const fb = cleanedRetry.indexOf("{");
        const lb = cleanedRetry.lastIndexOf("}");
        if (fb !== -1 && lb !== -1) cleanedRetry = cleanedRetry.slice(fb, lb + 1);

        const retryParsed = JSON.parse(cleanedRetry);
        parsed = retryParsed || parsed;
      } catch (e) {
        // keep original parsed
      }
    }

    // Normalize model output
    let caption = String(parsed.caption || captionDraft || "").trim();
    let hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((h) => String(h).trim()).filter(Boolean)
      : [];

    // Cleanup caption + enforce perspective
    caption = removeBannedWords(caption);
    caption = removeBannedActivities(caption, captionDraft);
    caption = removeBrandTextIfNotInDraft(caption, captionDraft);
    caption = forceUserPerspective(caption);
    caption = fixPlushAnimalHallucination(caption, captionDraft);
    caption = normalizeCaptionLength(caption, captionDraft);

    // Cleanup hashtags
    hashtags = adjustHashtags(hashtags, captionDraft);
    if (hashtags.length === 0) {
      const fallback = fallbackTagsFromDraft(captionDraft, 3);
      if (fallback.length > 0) hashtags = fallback;
    }

    // -------- Face recognition for friendTags (your existing logic) --------
    const FACE_THRESHOLD = 0.37;
    const MIN_GAP = 0.06;
    const MAX_TAGS = 5;

    let friendTagsMerged = [];

    const pickNamesFromFaceResp = (faceResp) => {
      const faces = Array.isArray(faceResp?.faces) ? faceResp.faces : [];
      const pickedNames = [];

      for (const f of faces) {
        const matches = Array.isArray(f.matches) ? f.matches : [];
        if (!matches.length) continue;

        let candidates = matches
          .map((m) => ({
            name: String(m.name || "").trim(),
            distance: typeof m.distance === "number" ? m.distance : Number(m.distance) || 999,
          }))
          .filter((m) => m.name && m.distance <= FACE_THRESHOLD)
          .sort((a, b) => a.distance - b.distance);

        if (!candidates.length) continue;

        const top = candidates[0];
        const next = candidates[1];

        if (next && Math.abs(next.distance - top.distance) < MIN_GAP) {
          continue;
        }

        pickedNames.push(top.name);
        if (pickedNames.length >= MAX_TAGS) break;
      }

      return pickedNames;
    };

    if (images.length > 0) {
      try {
        const FACE_IMAGES_LIMIT = 3;
        const scanImages = images.slice(0, FACE_IMAGES_LIMIT);

        const batch = await recognizeFaceBatch(scanImages, FACE_THRESHOLD);

        console.log("[VISION] FaceBatch FULL:\n", util.inspect(batch, { depth: null, colors: true }));

        const allPicked = [];
        for (const item of batch.results || []) {
          const faceRespLike = { faces: item.faces || [] };
          const names = pickNamesFromFaceResp(faceRespLike);
          allPicked.push(...names);
          if (allPicked.length >= MAX_TAGS) break;
        }

        friendTagsMerged = Array.from(new Set(allPicked)).slice(0, MAX_TAGS);
      } catch (err) {
        console.log("Face recognition in /generatePostMeta failed:", err);
      }
    }

    const cleaned = { caption, hashtags, friendTags: friendTagsMerged };
    console.log("[VISION] Cleaned content:\n", JSON.stringify(cleaned, null, 2));
    res.json(cleaned);
  } catch (err) {
    console.error("❌ Error in /generatePostMeta:", err);
    res.status(500).json({ error: "Failed to generate post meta" });
  }
});

// -------------------------
// /faces/detect
// -------------------------
app.post("/faces/detect", async (req, res) => {
  const { imageBase64List } = req.body || {};
  try {
    const result = await detectFacesInList(imageBase64List || []);
    res.json(result);
  } catch (err) {
    console.error("❌ /faces/detect error:", err);
    res.status(500).json({ error: "Face detect failed" });
  }
});

// -------------------------
// /faces/register
// -------------------------
app.post("/faces/register", async (req, res) => {
  const { personId, name, imageBase64 } = req.body || {};
  if (!name || !imageBase64) {
    return res.status(400).json({ error: "name and imageBase64 are required." });
  }

  try {
    const pyResp = await registerFace(name, imageBase64);
    console.log("✅ /faces/register -> Python:", pyResp);

    res.json({
      ok: pyResp.ok !== false,
      personId: personId || null,
      name: pyResp.name || name,
      encodingsCount: pyResp.encodingsCount || 1,
    });
  } catch (err) {
    console.error("❌ /faces/register proxy error:", err);
    res.status(500).json({ error: "Face register failed" });
  }
});

// -------------------------
// /faces/recognize
// -------------------------
app.post("/faces/recognize", async (req, res) => {
  const { imageBase64, threshold } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: "imageBase64 is required." });
  }

  try {
    const pyResp = await recognizeFace(imageBase64, threshold);
    console.log("✅ /faces/recognize -> Python:", util.inspect(pyResp, { depth: null, colors: true }));

    res.json({
      ok: pyResp.ok !== false,
      faces: Array.isArray(pyResp.faces) ? pyResp.faces : [],
    });
  } catch (err) {
    console.error("❌ /faces/recognize proxy error:", err);
    res.status(500).json({ error: "Face recognize failed" });
  }
});

// -------------------------
// ✅ /faces/recognize_batch
// -------------------------
app.post("/faces/recognize_batch", async (req, res) => {
  const { imageBase64List, threshold } = req.body || {};
  if (!Array.isArray(imageBase64List) || imageBase64List.length === 0) {
    return res.status(400).json({ error: "imageBase64List must be a non-empty array." });
  }

  try {
    const batch = await recognizeFaceBatch(imageBase64List, threshold);
    res.json(batch);
  } catch (err) {
    console.error("❌ /faces/recognize_batch proxy error:", err);
    res.status(500).json({ error: "Face recognize batch failed" });
  }
});

// -------------------------
// Start server
// -------------------------
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Local AI server running at http://${HOST}:${PORT}`);
});
