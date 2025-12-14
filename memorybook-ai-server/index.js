// index.js - Local AI + Face proxy server for MemoryBook
// Caption goal: "human social caption" + grounded + NO 1st/2nd/3rd person pronouns
// UPDATED: return emoji per post (AI), no score needed

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const util = require("util");

// 👉 import helpers that talk to Python face_api
const {
  detectFacesInList,
  registerFace,
  recognizeFace,
} = require("./face-service");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "20mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "ai server alive" });
});

// ---- Ollama config ----
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

// ✅ Better default text model for instruction-following
const OLLAMA_TEXT_MODEL =
  process.env.OLLAMA_TEXT_MODEL || "qwen2.5:7b-instruct";

// Vision model
const OLLAMA_VISION_MODEL =
  process.env.OLLAMA_VISION_MODEL || "llava-phi3:latest";

// -------------------------
// Small helpers
// -------------------------
function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

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

  const MAX_WORDS = 14;
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

function extractJsonBlock(raw) {
  let cleaned = String(raw || "").trim();
  if (!cleaned) return "";

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9]*\s*/, "");
    cleaned = cleaned.replace(/```$/, "").trim();
  }

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }

  return cleaned.trim();
}

function safeJsonParse(raw, fallback = null) {
  try {
    const block = extractJsonBlock(raw);
    if (!block) return fallback;
    return JSON.parse(block);
  } catch {
    return fallback;
  }
}

// ✅ Emoji mapping (used by client + mood calendar)
function emojiFromMoodLabel(label) {
  const l = String(label || "neutral").toLowerCase();
  if (l === "happy") return "😊";
  if (l === "neutral") return "😐";
  if (l === "tired") return "😴";
  if (l === "sad") return "😢";
  if (l === "angry") return "😡";
  return "😐";
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

// Hashtags: don’t allow sensitive guesses
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

// ---------------------------------------------------------
// Caption: "no 1st/2nd/3rd person" human social style helpers
// ---------------------------------------------------------
const PRONOUN_BLOCKLIST = [
  "i",
  "i'm",
  "im",
  "me",
  "my",
  "mine",
  "we",
  "we're",
  "were",
  "our",
  "ours",
  "us",
  "you",
  "you're",
  "youre",
  "your",
  "yours",
  "he",
  "she",
  "him",
  "her",
  "his",
  "hers",
  "they",
  "them",
  "their",
  "theirs",
];

function removePronouns(text) {
  let s = String(text || "");
  for (const p of PRONOUN_BLOCKLIST) {
    const re = new RegExp(
      `\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi"
    );
    s = s.replace(re, "");
  }
  return s.replace(/\s+/g, " ").trim();
}

function stripGenericIntros(text) {
  let s = String(text || "").trim();

  const patterns = [
    /^today\b[,:]?\s*/i,
    /^this\s+(is|was)\b[,:]?\s*/i,
    /^currently\b[,:]?\s*/i,
    /^just\b[,:]?\s*/i,
    /^here\s+(is|was)\b[,:]?\s*/i,
  ];

  for (const re of patterns) {
    if (re.test(s)) {
      s = s.replace(re, "");
      break;
    }
  }

  return s.trim();
}

function buildNeutralCaptionFromVision(visionCombined) {
  const v = String(visionCombined || "").toLowerCase();

  if (v.includes("outdoor")) return "Fresh air, good vibes.";
  if (v.includes("cafe") || v.includes("restaurant"))
    return "Cafe moment, locked in.";
  if (v.includes("table")) return "Table talk vibes.";
  if (v.includes("laptop")) return "Laptop open, focus mode.";
  if (v.includes("glasses")) return "Glasses on, mood on.";
  if (v.includes("phone")) return "Phone time, don’t disturb.";
  return "Moment captured.";
}

function detectUserIntent(draft) {
  const d = String(draft || "").toLowerCase();

  const flex = [
    "flex",
    "new look",
    "new style",
    "hair",
    "hairstyle",
    "outfit",
    "ootd",
    "slay",
    "glow up",
  ];

  if (flex.some((k) => d.includes(k))) {
    return "FLEX";
  }
  return "NORMAL";
}

// -------------------------
// Ollama helpers
// -------------------------
async function callOllamaChatText(prompt, modelOverride, temperatureOverride) {
  const model = modelOverride || OLLAMA_TEXT_MODEL;

  const resp = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model,
    messages: [{ role: "user", content: prompt }],
    format: "json",
    stream: false,
    options: {
      temperature:
        typeof temperatureOverride === "number" ? temperatureOverride : 0.25,
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
Describe ONLY what you clearly see.

Rules:
- Focus on the main subject.
- Ignore tiny/unclear background items.
- Do NOT invent emotions, memories, seasons, events, or stories.
- If you see "BOH" anywhere, IGNORE it and do NOT mention it.
Style: 1–2 short sentences, simple English.
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
// Vision – multi images describe (FIXED for carousel)
// Returns { combined, perPhoto }
// -------------------------
async function callOllamaVisionDescribeMulti(imageBase64List) {
  const safeList = Array.isArray(imageBase64List)
    ? imageBase64List.filter(Boolean)
    : [];
  if (!safeList.length) return { combined: "", perPhoto: [] };

  const total = safeList.length;
  const perPhoto = [];

  for (let i = 0; i < total; i++) {
    try {
      const desc = await describeSingleImage(safeList[i], i + 1, total);
      perPhoto.push(String(desc || "").trim());
    } catch (err) {
      console.log(
        `Vision describe error on photo ${i + 1}:`,
        err?.message || err
      );
      perPhoto.push("");
    }
  }

  const lines = perPhoto.map((d, i) =>
    d ? `Photo ${i + 1}: ${d}` : `Photo ${i + 1}: (unclear)`
  );

  // ✅ keep newlines so the text model understands "photo 1 vs photo 2"
  let combined = lines.join("\n");
  combined = combined.replace(/\bBOH\b/gi, "").trim();

  console.log("[VISION] Per-photo descriptions:\n", combined);
  return { combined, perPhoto };
}

// -------------------------
// Mood labels (emoji is derived from this)
// -------------------------
const MOOD_LABELS = ["happy", "neutral", "tired", "sad", "angry"];

// -------------------------
// NEW: Vision mood detection (faces + vibe)
// Returns { moodLabel, confidence }
// -------------------------
async function detectMoodFromVisionFirstImage(imageBase64) {
  if (!imageBase64) {
    return { moodLabel: "neutral", confidence: 0.0 };
  }

  const prompt = `
Return ONLY valid JSON:
{
  "moodLabel": "happy|neutral|tired|sad|angry",
  "confidence": 0.0-1.0,
  "reason": "short"
}

Task:
- Look ONLY at visible facial expression(s) in the photo.
- If facial expression is unclear / no face visible, return moodLabel "neutral" with low confidence (<= 0.25).
- Do NOT guess personal identity, age, or private traits.
`.trim();

  const body = {
    model: OLLAMA_VISION_MODEL,
    messages: [{ role: "user", content: prompt, images: [imageBase64] }],
    stream: false,
  };

  try {
    const resp = await axios.post(`${OLLAMA_URL}/api/chat`, body);
    const raw = String(resp.data?.message?.content || "");
    const parsed = safeJsonParse(raw, null);

    const moodLabel = MOOD_LABELS.includes(
      String(parsed?.moodLabel).toLowerCase()
    )
      ? String(parsed.moodLabel).toLowerCase()
      : "neutral";

    const confidence = clamp(parsed?.confidence ?? 0, 0, 1);

    return {
      moodLabel,
      confidence,
    };
  } catch (e) {
    return { moodLabel: "neutral", confidence: 0.0 };
  }
}

// -------------------------
// NEW: Caption mood detection (text-only)
// Returns { moodLabel, confidence }
// -------------------------
async function detectMoodFromCaptionText(captionText) {
  const caption = String(captionText || "").trim();

  if (!caption) {
    return { moodLabel: "neutral", confidence: 0.0 };
  }

  const prompt = `
Return ONLY valid JSON:
{
  "moodLabel": "happy|neutral|tired|sad|angry",
  "confidence": 0.0-1.0
}

Infer mood ONLY from the caption text tone.
If unsure, return "neutral" with confidence <= 0.25.

Caption:
"${caption}"
`.trim();

  try {
    const raw = await callOllamaChatText(prompt, OLLAMA_TEXT_MODEL, 0.1);
    const parsed = safeJsonParse(raw, null);

    const moodLabel = MOOD_LABELS.includes(
      String(parsed?.moodLabel).toLowerCase()
    )
      ? String(parsed.moodLabel).toLowerCase()
      : "neutral";
    const confidence = clamp(parsed?.confidence ?? 0, 0, 1);

    return {
      moodLabel,
      confidence,
    };
  } catch {
    return { moodLabel: "neutral", confidence: 0.0 };
  }
}

// -------------------------
// NEW: Combine mood (face + caption) WITHOUT score
// Returns { moodLabel, moodSource, confidence }
// -------------------------
function combineMood(faceMood, captionMood) {
  const f = faceMood || { moodLabel: "neutral", confidence: 0 };
  const c = captionMood || { moodLabel: "neutral", confidence: 0 };

  // If both confident and same label -> boost
  if (
    f.confidence >= 0.45 &&
    c.confidence >= 0.45 &&
    f.moodLabel === c.moodLabel
  ) {
    return {
      moodLabel: f.moodLabel,
      moodSource: "face+caption",
      confidence: clamp((f.confidence + c.confidence) / 2 + 0.1, 0, 1),
    };
  }

  // Pick higher-confidence one if decent
  if (f.confidence >= c.confidence && f.confidence >= 0.35) {
    return {
      moodLabel: f.moodLabel,
      moodSource: "face",
      confidence: f.confidence,
    };
  }

  if (c.confidence > f.confidence && c.confidence >= 0.35) {
    return {
      moodLabel: c.moodLabel,
      moodSource: "caption",
      confidence: c.confidence,
    };
  }

  // Otherwise neutral
  return {
    moodLabel: "neutral",
    moodSource: "unknown",
    confidence: Math.max(f.confidence, c.confidence),
  };
}

// -------------------------
// Face recognize batch
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
// Grounding helpers
// -------------------------
function buildMustKeywordsFromFirstPhoto(perPhoto) {
  const first = String(perPhoto?.[0] || "").toLowerCase();

  const pool = [
    "glasses",
    "watch",
    "outdoor",
    "cafe",
    "restaurant",
    "street",
    "table",
    "phone",
  ];

  // ✅ only enforce if FIRST photo clearly shows it
  const must = pool.filter((k) => first.includes(k));

  // ✅ keep very light: 0–1 keyword (avoid forcing weird object captions)
  return Array.from(new Set(must)).slice(0, 1);
}

function captionLooksUngrounded(
  caption,
  visionDescription,
  captionDraft,
  mustKeywords
) {
  const c = String(caption || "").toLowerCase();
  const v = String(visionDescription || "").toLowerCase();
  const d = String(captionDraft || "").toLowerCase();

  if (mustKeywords && mustKeywords.length) {
    const ok = mustKeywords.some((k) => c.includes(k));
    if (!ok) return true;
  }

  const fantasy = [
    "childhood",
    "nostalgia",
    "cherished",
    "magical",
    "lucky charm",
    "river",
    "stream",
    "summer",
    "winter",
    "sun touched",
    "fish",
  ];
  for (const w of fantasy) {
    if (c.includes(w) && !v.includes(w) && !d.includes(w)) return true;
  }

  return false;
}

// -------------------------
// /ai/random-memory (kept + bugfix)
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

    let parsed = safeJsonParse(raw, null);

    // fallback picker
    const good = trimmed.filter((g) => g.postCount >= 2);
    const pickFrom = good.length ? good : trimmed;

    if (!parsed || !parsed.selectedGroupId) {
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
      const idx = Math.floor(Math.random() * pickFrom.length);
      return res.json({
        selectedGroupId: pickFrom[idx].id,
        confidence: 0.35,
        reason: "Fallback selection (AI returned unknown id).",
      });
    }

    res.json({
      selectedGroupId: selected,
      confidence: clamp(Number(parsed.confidence ?? 0.6), 0, 1),
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
    const {
      captionDraft = "",
      imageBase64List = [],
      imageBase64 = null,
    } = req.body || {};

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

    // 1) Vision (objects/scene) - FIXED for carousel
    let visionDescription = "";
    let visionPerPhoto = [];

    if (images.length > 0) {
      try {
        const v = await callOllamaVisionDescribeMulti(images);
        visionDescription = v.combined;
        visionPerPhoto = v.perPhoto || [];
        console.log("[VISION] Description:\n", visionDescription);
      } catch (err) {
        console.log("⚠️ Vision error (continue):", err?.message || err);
      }
    }

    // ✅ mustKeywords only from photo 1 (prevents 2nd photo "phone" forcing caption)
    const mustKeywords = buildMustKeywordsFromFirstPhoto(visionPerPhoto);

    const mustLine =
      mustKeywords.length > 0
        ? `- Caption should naturally include: ${mustKeywords.join(
            ", "
          )} (only if it fits).`
        : `- If vision is unclear, keep caption generic and simple.`;

    const intent = detectUserIntent(captionDraft);

    // 2) TEXT MODEL prompt (grounded + human + no-person pronouns)
    const systemInstruction = `
You write SHORT, human-style captions for a memory app.

Return ONLY valid JSON:
{
  "caption": "string",
  "hashtags": ["tag1","tag2"],
  "friendTags": ["name1","name2"]
}

GROUNDING RULES (MUST FOLLOW):
- Use ONLY the vision description + user draft. Do NOT invent stories.
- This is a carousel post (multiple photos). Caption should describe the overall moment/vibe,
  NOT list objects from each photo.
- Do NOT merge details incorrectly (e.g., "phone in hand" if only one photo shows it).
- Do NOT mention rivers, lucky charms, magical events, childhood, seasons unless supported by vision/draft.
${mustLine}

CAPTION STYLE (MUST FOLLOW):
- Do NOT use 1st/2nd/3rd person pronouns (no I / we / you / he / she / they).
- Sound like a real social post: short, confident, not essay-like.
- Prefer punchy phrases, reactions, or “announcement/flex” tone if the user draft implies it.
- 6–14 words, 0–1 emoji.
- No hashtags inside the caption.
- Avoid generic “Today...” openings.

HASHTAGS:
- 1–5 tags, lowercase, derived from visible objects only (no fantasy tags).

FRIEND TAGS:
- Do NOT invent names; return [] unless user typed names in draft.
`.trim();

    const combinedPrompt = `${systemInstruction}

User intent hint:
"${intent}" (FLEX means: show off / confident / new look vibe)

User draft (may be empty):
"${captionDraft || "(empty)"}"

Vision description (may be empty):
"${visionDescription || "(no description)"}"
`.trim();

    let rawContent = "";
    try {
      rawContent = await callOllamaChatText(combinedPrompt);
    } catch (err) {
      console.error("⚠️ Text model error:", err?.message || err);
      rawContent = JSON.stringify({
        caption: captionDraft || "",
        hashtags: [],
        friendTags: [],
      });
    }

    console.log("[TEXT] Raw:", rawContent);

    // Parse JSON safely
    let parsed = safeJsonParse(rawContent, null);
    if (!parsed) {
      parsed = { caption: captionDraft, hashtags: [], friendTags: [] };
    }

    // Retry once if ungrounded / too weird
    let captionTry = String(parsed.caption || captionDraft || "").trim();
    if (
      captionLooksUngrounded(
        captionTry,
        visionDescription,
        captionDraft,
        mustKeywords
      )
    ) {
      const retryPrompt =
        combinedPrompt +
        `

Your previous answer was NOT grounded / too weird.
Rewrite again using ONLY vision + draft. Return ONLY JSON.
`.trim();

      try {
        const retryRaw = await callOllamaChatText(retryPrompt);
        const retryParsed = safeJsonParse(retryRaw, null);
        if (retryParsed) parsed = retryParsed;
      } catch {
        // keep original
      }
    }

    // Normalize model output
    let caption = String(parsed.caption || captionDraft || "").trim();
    let hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((h) => String(h).trim()).filter(Boolean)
      : [];

    // Cleanup caption (NO person enforcement)
    caption = removeBannedWords(caption);
    caption = removeBannedActivities(caption, captionDraft);
    caption = removeBrandTextIfNotInDraft(caption, captionDraft);
    caption = fixPlushAnimalHallucination(caption, captionDraft);

    caption = stripGenericIntros(caption);
    caption = removePronouns(caption);
    caption = normalizeCaptionLength(caption, captionDraft);

    // If still ungrounded, hard fallback from vision (neutral, no pronouns)
    if (
      !caption ||
      captionLooksUngrounded(
        caption,
        visionDescription,
        captionDraft,
        mustKeywords
      )
    ) {
      caption = buildNeutralCaptionFromVision(visionDescription);
    }

    // Cleanup hashtags
    hashtags = adjustHashtags(hashtags, captionDraft);
    if (hashtags.length === 0) {
      const fallback = fallbackTagsFromDraft(captionDraft, 3);
      if (fallback.length > 0) hashtags = fallback;
    }

    // Face recognition for friendTags
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
            distance:
              typeof m.distance === "number"
                ? m.distance
                : Number(m.distance) || 999,
          }))
          .filter((m) => m.name && m.distance <= FACE_THRESHOLD)
          .sort((a, b) => a.distance - b.distance);

        if (!candidates.length) continue;

        const top = candidates[0];
        const next = candidates[1];

        // If top two are too close, skip to avoid wrong tag
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

        console.log(
          "[FACE] Batch FULL:\n",
          util.inspect(batch, { depth: null, colors: true })
        );

        const allPicked = [];
        for (const item of batch.results || []) {
          const faceRespLike = { faces: item.faces || [] };
          const names = pickNamesFromFaceResp(faceRespLike);
          allPicked.push(...names);
          if (allPicked.length >= MAX_TAGS) break;
        }

        friendTagsMerged = Array.from(new Set(allPicked)).slice(0, MAX_TAGS);
      } catch (err) {
        console.log("Face recognition failed:", err?.message || err);
      }
    }

    // -------------------------
    // Mood detection (face + caption) -> return emoji
    // -------------------------
    let moodLabel = "neutral";
    let moodSource = "unknown";
    let emoji = "😐";

    try {
      const firstImage = images.length ? images[0] : null;

      const [faceMood, captionMood] = await Promise.all([
        detectMoodFromVisionFirstImage(firstImage),
        detectMoodFromCaptionText(caption),
      ]);

      const combined = combineMood(faceMood, captionMood);

      moodLabel = combined.moodLabel;
      moodSource = combined.moodSource;
      emoji = emojiFromMoodLabel(moodLabel);

      console.log(
        "[MOOD] face:",
        faceMood,
        "caption:",
        captionMood,
        "=>",
        combined,
        "emoji:",
        emoji
      );
    } catch (e) {
      emoji = "😐";
      moodLabel = "neutral";
      moodSource = "unknown";
    }

    const cleaned = {
      caption,
      hashtags,
      friendTags: friendTagsMerged,

      // ✅ what your client should save per post
      emoji,

      // (optional debug fields)
      moodLabel,
      moodSource,
    };

    console.log("[RESULT] Cleaned:\n", JSON.stringify(cleaned, null, 2));
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
    console.log(
      "✅ /faces/recognize -> Python:",
      util.inspect(pyResp, { depth: null, colors: true })
    );

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
// /faces/recognize_batch
// -------------------------
app.post("/faces/recognize_batch", async (req, res) => {
  const { imageBase64List, threshold } = req.body || {};
  if (!Array.isArray(imageBase64List) || imageBase64List.length === 0) {
    return res
      .status(400)
      .json({ error: "imageBase64List must be a non-empty array." });
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
const HOST = process.env.HOST || "0.0.0.0"; // ✅ important for phone access

app.listen(PORT, HOST, () => {
  console.log(`Local AI server running at http://${HOST}:${PORT}`);
});

// -------------------------
// Proxy to Ollama /api/generate (for web CORS)
// -------------------------
app.post("/ollama/generate", async (req, res) => {
  try {
    const { model, prompt, stream = false, options = {} } = req.body || {};
    if (!model || !prompt) {
      return res
        .status(400)
        .json({ error: "model and prompt are required." });
    }

    const body = {
      model,
      prompt,
      stream,
      options: {
        temperature: 0.2,
        num_predict: 256,
        top_p: 0.9,
        ...options,
      },
    };

    const resp = await axios.post(`${OLLAMA_URL}/api/generate`, body, {
      headers: { "Content-Type": "application/json" },
    });

    res.json(resp.data);
  } catch (err) {
    console.error("Proxy /ollama/generate error:", err?.message || err);
    res.status(500).json({ error: "Failed to call Ollama generate" });
  }
});
