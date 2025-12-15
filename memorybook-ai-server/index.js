// index.js - Local AI + Face proxy server for MemoryBook
// ✅ Updated (your requests):
// - NEVER start caption with "lowkey", "friend/friends", "person/people"
// - If user sends draft/keywords, caption MUST contain user keyword/draft (enforced)
// - If draft exists: use (draft + vision) to write caption (draft is PRIMARY)
// - Remove "glasses" mentions unless user typed it in draft
// - Safer, less-weird fallback captions (no "lowkey moment, captured.")
// - Keep: /generatePostMeta + face proxy endpoints + ollama proxy

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
app.use(bodyParser.json({ limit: "50mb" }));

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
// ✅ base64 normalizer
// -------------------------
function normalizeBase64Image(input) {
  if (!input) return "";
  let s = String(input).trim();
  if (!s) return "";

  const comma = s.indexOf(",");
  if (s.startsWith("data:") && comma !== -1) s = s.slice(comma + 1);

  s = s.replace(/\s+/g, "").trim();
  if (s.length < 64) return "";
  return s;
}

function normalizeBase64List(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.map(normalizeBase64Image).filter(Boolean);
}

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

  const MAX_WORDS = 20;
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
  if (first !== -1 && last !== -1 && last > first)
    cleaned = cleaned.slice(first, last + 1);

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

// ✅ Emoji mapping
function emojiFromMoodLabel(label) {
  const l = String(label || "neutral").toLowerCase();
  if (l === "happy") return "😊";
  if (l === "neutral") return "😐";
  if (l === "tired") return "😴";
  if (l === "sad") return "😢";
  if (l === "angry") return "😡";
  return "😐";
}

// -------------------------
// Cleanup helpers
// -------------------------
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
  if (!draftLower.includes("boh")) result = result.replace(/\bBOH\b/gi, "").trim();
  return result.replace(/\s+/g, " ").trim();
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

// ✅ Replace gendered / identity-ish labels -> neutral
function neutralizePersonWords(text, captionDraft = "") {
  let s = String(text || "");
  const d = String(captionDraft || "").toLowerCase();

  const allowGenderWords =
    d.includes("man") ||
    d.includes("woman") ||
    d.includes("boy") ||
    d.includes("girl") ||
    d.includes("male") ||
    d.includes("female") ||
    d.includes("guy") ||
    d.includes("lady");

  if (allowGenderWords) return s.replace(/\s+/g, " ").trim();

  const replacements = [
    [/\b(a|an)\s+man\b/gi, "a friend"],
    [/\b(a|an)\s+woman\b/gi, "a friend"],
    [/\bman\b/gi, "person"],
    [/\bwoman\b/gi, "person"],
    [/\bboy\b/gi, "person"],
    [/\bgirl\b/gi, "person"],
    [/\bguy\b/gi, "person"],
    [/\blady\b/gi, "person"],
    [/\bmale\b/gi, "person"],
    [/\bfemale\b/gi, "person"],
  ];

  for (const [re, rep] of replacements) s = s.replace(re, rep);
  s = s.replace(/\bposes?\s+with\b/gi, "photo moment with");

  return s.replace(/\s+/g, " ").trim();
}

// ✅ remove accessory/clothing mentions unless user typed it
const ACCESSORY_WORDS = ["glasses", "spectacles", "eyeglasses", "sunglasses"];

function removeAccessoryMentionsIfNotInDraft(text, captionDraft) {
  const draftLower = String(captionDraft || "").toLowerCase();
  let s = String(text || "");

  const allow = ACCESSORY_WORDS.some((w) => draftLower.includes(w));
  if (allow) return s.replace(/\s+/g, " ").trim();

  const patterns = [
    /\bglasses\s+on\b/gi,
    /\bwith\s+glasses\b/gi,
    /\bwearing\s+glasses\b/gi,
    /\b(glasses|spectacles|eyeglasses|sunglasses)\b/gi,
  ];

  for (const re of patterns) s = s.replace(re, "");

  s = s
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\.\s*\./g, ".")
    .trim();

  s = s.replace(/^[-–—,:]+\s*/g, "").trim();

  return s;
}

// ✅ prevent caption starting with "person/people/friends" (and NEVER "lowkey")
function avoidBadStarts(caption, visionDesc, captionDraft) {
  let c = String(caption || "").trim();
  if (!c) return c;

  const badStartRe = /^(lowkey\b|low-key\b|friend\b|friends\b|a\s+friend\b|person\b|a\s+person\b|people\b)/i;
  if (!badStartRe.test(c)) return c;

  const v = String(visionDesc || "").toLowerCase();
  const d = String(captionDraft || "").trim();

  // If draft exists and is short, lead with draft instead of generic starter
  if (d) {
    const shortDraft = d.replace(/\s+/g, " ").trim();
    if (shortDraft.length <= 45) {
      c = `${shortDraft} — ${c.replace(badStartRe, "").trim()}`.trim();
      c = c.replace(/^[—–-]+\s*/g, "").trim();
      if (!badStartRe.test(c)) return c;
    }
  }

  // Otherwise choose safe starter by vision
  if (v.includes("books") || v.includes("book")) return "Books out, brain loading.";
  if (v.includes("store") || v.includes("shopping")) return "Quick stop, good vibes.";
  if (v.includes("cafe") || v.includes("restaurant")) return "Cafe vibes, keep it chill.";
  if (v.includes("outdoor") || v.includes("street")) return "Out and about, good vibes.";
  if (v.includes("table")) return "Simple table vibes, clean and calm.";
  if (v.includes("laptop")) return "Locked in, focus vibes.";
  if (v.includes("phone")) return "Phone out, keep it simple.";

  // No "lowkey moment, captured." anymore:
  return "Clean moment, good vibes.";
}

// -------------------------
// Hashtags
// -------------------------
function adjustHashtags(hashtags) {
  let tags = Array.isArray(hashtags) ? [...hashtags] : [];

  tags = tags
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase().replace(/\s+/g, ""));

  tags = Array.from(new Set(tags));

  const BANNED_ALWAYS = ["boh", "bohtea", "bohteamalaysia"];
  tags = tags.filter((t) => !BANNED_ALWAYS.includes(t));

  return tags.slice(0, 5);
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
    .filter((t) => t.length >= 2)
    .filter((t) => /^[a-z0-9]+$/i.test(t));

  return Array.from(new Set(cleaned)).slice(0, max);
}

function extractDraftKeywords(draft, max = 2) {
  const raw = String(draft || "").trim();
  const d = raw.toLowerCase();
  if (!d) return [];

  // keep hashtags as keywords too
  const hash = raw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.startsWith("#"))
    .map((t) => t.replace(/^#+/, "").replace(/[^a-z0-9_-]/gi, ""))
    .filter(Boolean);

  const stop = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "to",
    "for",
    "of",
    "in",
    "on",
    "at",
    "with",
    "this",
    "that",
    "these",
    "those",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "today",
    "yesterday",
    "tomorrow",
    "very",
    "so",
    "just",
    "really",
    "pls",
    "please",
    "trip",
    "travel",
  ]);

  const tokens = d
    .replace(/[^a-z0-9\s#_-]/g, " ")
    .replace(/[#]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 2)
    .filter((t) => !stop.has(t));

  const uniq = [];
  for (const t of [...hash, ...tokens]) {
    if (!uniq.includes(t)) uniq.push(t);
    if (uniq.length >= max) break;
  }
  return uniq;
}

// ✅ HARD ENFORCE: caption must contain user keyword/draft (when draft exists)
function enforceCaptionContainsUserInput(caption, draftText, draftKeywords) {
  let c = String(caption || "").trim();
  const d = String(draftText || "").trim();
  if (!d) return c;

  const lc = c.toLowerCase();
  const hasKeyword =
    Array.isArray(draftKeywords) && draftKeywords.length
      ? draftKeywords.some((k) => lc.includes(String(k).toLowerCase()))
      : false;

  // If user draft is short, require the EXACT draft string (as substring)
  const shortDraft = d.replace(/\s+/g, " ").trim();
  const requireExact = shortDraft.length <= 45;

  if (requireExact) {
    if (!c.includes(shortDraft)) {
      c = `${shortDraft} — ${c}`.replace(/\s+/g, " ").trim();
    }
    return c;
  }

  // Otherwise require at least one extracted keyword
  if (draftKeywords && draftKeywords.length && !hasKeyword) {
    const prefix = draftKeywords.join(" ");
    c = `${prefix} — ${c}`.replace(/\s+/g, " ").trim();
  }

  return c;
}

// ---------------------------------------------------------
// Pronoun blockers
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

// ✅ No more "Lowkey moment, captured."
function buildNeutralCaptionFromVision(visionCombined) {
  const v = String(visionCombined || "").toLowerCase();
  if (v.includes("outdoor") || v.includes("street")) return "Out and about, good vibes.";
  if (v.includes("cafe") || v.includes("restaurant")) return "Cafe vibes, keep it chill.";
  if (v.includes("store") || v.includes("shopping")) return "Quick stop, good vibes.";
  if (v.includes("table")) return "Simple table vibes, clean and calm.";
  if (v.includes("laptop")) return "Locked in, focus vibes.";
  if (v.includes("phone")) return "Phone out, keep it simple.";
  if (v.includes("books") || v.includes("book")) return "Books out, brain loading.";
  return "Simple scene, good vibes.";
}

function detectUserIntent(draft) {
  const d = String(draft || "").toLowerCase();
  const flex = ["flex", "new look", "new style", "hair", "hairstyle", "outfit", "ootd", "slay", "glow up"];
  if (flex.some((k) => d.includes(k))) return "FLEX";
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
      temperature: typeof temperatureOverride === "number" ? temperatureOverride : 0.25,
      top_p: 0.9,
      num_predict: 260,
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
This is photo ${index} of ${total}.
Describe ONLY what is clearly visible.

CRITICAL RULES:
- Use ONLY neutral words: "person", "people", "friends".
- NEVER say: man/woman/boy/girl/male/female/guy/lady.
- Do NOT guess age, identity, relationship, or emotions.
- Ignore tiny/unclear background items.
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
// Vision – multi images describe
// -------------------------
async function callOllamaVisionDescribeMulti(imageBase64List) {
  const safeList = Array.isArray(imageBase64List) ? imageBase64List.filter(Boolean) : [];
  if (!safeList.length) return { combined: "", perPhoto: [] };

  const total = safeList.length;
  const perPhoto = [];

  for (let i = 0; i < total; i++) {
    try {
      const desc = await describeSingleImage(safeList[i], i + 1, total);
      perPhoto.push(neutralizePersonWords(String(desc || ""), ""));
    } catch (err) {
      console.log(`Vision describe error on photo ${i + 1}:`, err?.message || err);
      perPhoto.push("");
    }
  }

  const lines = perPhoto.map((d, i) => (d ? `Photo ${i + 1}: ${d}` : `Photo ${i + 1}: (unclear)`));
  let combined = lines.join("\n");
  combined = combined.replace(/\bBOH\b/gi, "").trim();

  console.log("[VISION] Per-photo descriptions:\n", combined);
  return { combined, perPhoto };
}

// -------------------------
// Mood labels
// -------------------------
const MOOD_LABELS = ["happy", "neutral", "tired", "sad", "angry"];

// -------------------------
// Vision mood detection (faces only - AI estimate)
// -------------------------
async function detectMoodFromVisionFirstImage(imageBase64) {
  if (!imageBase64) return { moodLabel: "neutral", confidence: 0.0, hasHumanFace: false };

  const prompt = `
Return ONLY valid JSON:
{
  "hasHumanFace": true|false,
  "moodLabel": "happy|neutral|tired|sad|angry",
  "confidence": 0.0-1.0
}

Task:
- Decide if a REAL HUMAN FACE is visible (not toys/prints/dolls).
- If no human face visible -> hasHumanFace=false, moodLabel="neutral", confidence<=0.25.
- If human face is visible -> infer mood ONLY from facial expression.
- If unclear -> moodLabel="neutral" and confidence<=0.25.
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

    const hasHumanFace = !!parsed?.hasHumanFace;
    const moodLabel = MOOD_LABELS.includes(String(parsed?.moodLabel).toLowerCase())
      ? String(parsed.moodLabel).toLowerCase()
      : "neutral";
    const confidence = clamp(parsed?.confidence ?? 0, 0, 1);

    return { moodLabel, confidence, hasHumanFace };
  } catch {
    return { moodLabel: "neutral", confidence: 0.0, hasHumanFace: false };
  }
}

// -------------------------
// Face recognize batch (python)
// -------------------------
async function recognizeFaceBatch(imageBase64List, threshold) {
  const safeList = Array.isArray(imageBase64List) ? imageBase64List.filter(Boolean) : [];
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
  const pool = ["outdoor", "cafe", "restaurant", "street", "shopping", "store", "table"];
  const must = pool.filter((k) => first.includes(k));
  return Array.from(new Set(must)).slice(0, 1);
}

function captionLooksUngrounded(caption, visionDescription, captionDraft, mustKeywords) {
  const c = String(caption || "").toLowerCase();
  const v = String(visionDescription || "").toLowerCase();
  const d = String(captionDraft || "").toLowerCase();
  const draftHasText = d.trim().length > 0;

  if (!draftHasText && mustKeywords && mustKeywords.length) {
    const ok = mustKeywords.some((k) => c.includes(k));
    if (!ok) return true;
  }

  const fantasy = ["childhood", "nostalgia", "cherished", "magical", "lucky charm", "river", "stream", "summer", "winter", "sun touched", "fish"];
  for (const w of fantasy) {
    if (c.includes(w) && !v.includes(w) && !d.includes(w)) return true;
  }
  return false;
}

// -------------------------
// /generatePostMeta
// -------------------------
app.post("/generatePostMeta", async (req, res) => {
  try {
    const { captionDraft = "", imageBase64List = [], imageBase64 = null } = req.body || {};

    const listFromArray = normalizeBase64List(imageBase64List);
    const single = normalizeBase64Image(imageBase64);
    const images = listFromArray.length > 0 ? listFromArray : single ? [single] : [];

    const draftText = String(captionDraft || "").trim();
    const draftHasText = draftText.length > 0;

    console.log("\n🧠 /generatePostMeta received. Images count:", images.length, "Draft:", draftText);

    // 1) Vision
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

    const mustKeywords = buildMustKeywordsFromFirstPhoto(visionPerPhoto);
    const intent = detectUserIntent(draftText);

    const draftKeywords = draftHasText ? extractDraftKeywords(draftText, 2) : [];
    const draftKeywordsLine =
      draftKeywords.length > 0
        ? `- MUST include user keyword(s) in final caption: ${draftKeywords.join(", ")}.`
        : `- If draft is empty, rely on vision description only.`;

    // 2) TEXT model prompt
    const systemInstruction = `
You write SHORT, human-style captions for a memory app.

Return ONLY valid JSON:
{
  "caption": "string",
  "hashtags": ["tag1","tag2"],
  "friendTags": ["name1","name2"]
}

PRIORITY RULES:
- If user draft is NOT empty, it is the PRIMARY source of truth.
  The final caption MUST contain the user's draft (or user's keywords) — do not drop it.
- Vision description is SECONDARY: only used to support tone or add safe detail.
- Never override user draft with a different place/event.
${draftKeywordsLine}

GROUNDING RULES:
- Do NOT invent stories.
- Avoid fantasy concepts unless written in the draft.

CAPTION STYLE:
- Do NOT use 1st/2nd/3rd person pronouns (no I / we / you / he / she / they).
- IMPORTANT: Do NOT say "a man" / "a woman" / boy / girl / male / female / guy / lady.
  Use "friends", "people", or "person" only (but NOT as the opening word).
- ✅ Do NOT start the caption with any of these:
  "lowkey", "low-key", "friend", "friends", "person", "people".
  Start with a vibe/scene/action words instead.
- 8–20 words, 0–1 emoji.
- No hashtags inside the caption.
- Avoid generic “Today...” openings.

IMPORTANT DETAIL RULE:
- Do NOT mention clothing/accessories/body features (e.g., glasses, hair, shirt color)
  UNLESS the user wrote them in the draft.

HASHTAGS:
- 1–5 tags, lowercase.
- If draft exists, hashtags derived from draft first, then vision.

FRIEND TAGS:
- Do NOT invent names; return [] unless user typed names in draft.
`.trim();

    const combinedPrompt = `${systemInstruction}

User intent hint:
"${intent}" (FLEX means: confident / show-off vibe)

User draft/keywords (may be empty):
"${draftText || "(empty)"}"

Vision description (may be empty):
"${visionDescription || "(no description)"}"
`.trim();

    let rawContent = "";
    try {
      rawContent = await callOllamaChatText(combinedPrompt);
    } catch (err) {
      console.error("⚠️ Text model error:", err?.message || err);
      rawContent = JSON.stringify({ caption: draftText || "", hashtags: [], friendTags: [] });
    }

    console.log("[TEXT] Raw:", rawContent);

    let parsed = safeJsonParse(rawContent, null);
    if (!parsed) parsed = { caption: draftText, hashtags: [], friendTags: [] };

    // Retry once if ungrounded OR violates draft alignment OR starts badly
    let captionTry = String(parsed.caption || draftText || "").trim();

    const violatesDraft =
      draftHasText && draftKeywords.length
        ? !draftKeywords.some((k) => captionTry.toLowerCase().includes(String(k).toLowerCase()))
        : false;

    const startsBad = /^(lowkey\b|low-key\b|friend\b|friends\b|person\b|people\b|a\s+person\b|a\s+friend\b)/i.test(
      captionTry
    );

    if (captionLooksUngrounded(captionTry, visionDescription, draftText, mustKeywords) || violatesDraft || startsBad) {
      const retryPrompt =
        combinedPrompt +
        `

Previous answer not acceptable.
- MUST keep user draft/keyword in caption (do not omit).
- Keep grounded; do NOT invent places/events.
- Do NOT mention clothes/accessories unless user typed it.
- Do NOT start with "lowkey/low-key/friend(s)/person/people".
Return ONLY JSON.
`.trim();

      try {
        const retryRaw = await callOllamaChatText(retryPrompt);
        const retryParsed = safeJsonParse(retryRaw, null);
        if (retryParsed) parsed = retryParsed;
      } catch {}
    }

    // Normalize output
    let caption = String(parsed.caption || draftText || "").trim();
    let hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((h) => String(h).trim()).filter(Boolean)
      : [];

    // Cleanup caption
    caption = removeBannedWords(caption);
    caption = removeBannedActivities(caption, draftText);
    caption = removeBrandTextIfNotInDraft(caption, draftText);
    caption = fixPlushAnimalHallucination(caption, draftText);

    caption = stripGenericIntros(caption);
    caption = removePronouns(caption);
    caption = neutralizePersonWords(caption, draftText);

    // ✅ remove "glasses" mentions unless in draft
    caption = removeAccessoryMentionsIfNotInDraft(caption, draftText);

    // ✅ HARD enforce: must include user keyword/draft if provided
    caption = enforceCaptionContainsUserInput(caption, draftText, draftKeywords);

    caption = normalizeCaptionLength(caption, draftText);

    // ✅ final: remove bad starts like "lowkey" / "friend" / "person"
    caption = avoidBadStarts(caption, visionDescription, draftText);

    // Fallback only if empty
    if (!caption) {
      caption = draftHasText
        ? `${draftText.split(/\s+/).slice(0, 6).join(" ")} — keep it chill.`
        : buildNeutralCaptionFromVision(visionDescription);

      caption = neutralizePersonWords(caption, draftText);
      caption = removeAccessoryMentionsIfNotInDraft(caption, draftText);
      caption = enforceCaptionContainsUserInput(caption, draftText, draftKeywords);
      caption = avoidBadStarts(caption, visionDescription, draftText);
      caption = normalizeCaptionLength(caption, draftText);
    }

    // Hashtags: draft-first
    const draftTags = draftHasText ? fallbackTagsFromDraft(draftText, 5) : [];
    hashtags = adjustHashtags(hashtags);

    if (draftHasText) {
      const merged = Array.from(new Set([...draftTags, ...hashtags]));
      hashtags = merged.slice(0, 5);
    } else {
      if (hashtags.length === 0) hashtags = draftTags.slice(0, 3);
    }

    // Face recognition for friendTags (python)
    const FACE_THRESHOLD = 0.37;
    const MIN_GAP = 0.06;
    const MAX_TAGS = 5;

    let friendTagsMerged = [];
    let hasRealHumanFace = false;

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
        if (next && Math.abs(next.distance - top.distance) < MIN_GAP) continue;

        pickedNames.push(top.name);
        if (pickedNames.length >= MAX_TAGS) break;
      }

      return pickedNames;
    };

    if (images.length > 0) {
      try {
        const scanImages = images.slice(0, 3);
        const batch = await recognizeFaceBatch(scanImages, FACE_THRESHOLD);

        console.log("[FACE] Batch FULL:\n", util.inspect(batch, { depth: null, colors: true }));

        hasRealHumanFace = (batch?.results || []).some((r) => {
          const faces = Array.isArray(r?.faces) ? r.faces : [];
          return faces.length > 0;
        });

        const allPicked = [];
        for (const item of batch.results || []) {
          const names = pickNamesFromFaceResp({ faces: item.faces || [] });
          allPicked.push(...names);
          if (allPicked.length >= MAX_TAGS) break;
        }

        friendTagsMerged = Array.from(new Set(allPicked)).slice(0, MAX_TAGS);
      } catch (err) {
        console.log("Face recognition failed:", err?.message || err);
        hasRealHumanFace = false;
      }
    }

    // ✅ Mood detection: your rule
    let moodLabel = "happy";
    let moodSource = "rule";
    let emoji = "😊";

    try {
      if (!hasRealHumanFace) {
        moodLabel = "happy";
        moodSource = "rule";
        emoji = "😊";
        console.log("[MOOD] python says no face => force rule happy");
      } else {
        const firstImage = images.length ? images[0] : null;
        const visionMood = await detectMoodFromVisionFirstImage(firstImage);
        const visionSaysFace = !!visionMood?.hasHumanFace;

        if (visionSaysFace && Number(visionMood?.confidence || 0) >= 0.35) {
          const lbl = MOOD_LABELS.includes(String(visionMood.moodLabel).toLowerCase())
            ? String(visionMood.moodLabel).toLowerCase()
            : "neutral";

          moodLabel = lbl;
          moodSource = "face";
          emoji = emojiFromMoodLabel(moodLabel);

          console.log("[MOOD] python face + vision face:", visionMood, "=>", { moodLabel, moodSource, emoji });
        } else {
          moodLabel = "neutral";
          moodSource = "face";
          emoji = emojiFromMoodLabel(moodLabel);
          console.log("[MOOD] python face but vision unsure => neutral", visionMood);
        }
      }
    } catch (e) {
      moodLabel = "happy";
      moodSource = "rule";
      emoji = "😊";
      console.log("[MOOD] error => fallback happy:", e?.message || e);
    }

    const cleaned = {
      caption,
      hashtags,
      friendTags: friendTagsMerged,
      emoji,
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
    const normalized = normalizeBase64List(imageBase64List || []);
    const result = await detectFacesInList(normalized);
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
  const img = normalizeBase64Image(imageBase64);

  if (!name || !img) {
    return res.status(400).json({ error: "name and imageBase64 are required." });
  }

  try {
    const pyResp = await registerFace(name, img);
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
  const img = normalizeBase64Image(imageBase64);

  if (!img) return res.status(400).json({ error: "imageBase64 is required." });

  try {
    const pyResp = await recognizeFace(img, threshold);
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
// /faces/recognize_batch
// -------------------------
app.post("/faces/recognize_batch", async (req, res) => {
  const { imageBase64List, threshold } = req.body || {};
  if (!Array.isArray(imageBase64List) || imageBase64List.length === 0) {
    return res.status(400).json({ error: "imageBase64List must be a non-empty array." });
  }

  try {
    const normalized = normalizeBase64List(imageBase64List);
    const batch = await recognizeFaceBatch(normalized, threshold);
    res.json(batch);
  } catch (err) {
    console.error("❌ /faces/recognize_batch proxy error:", err);
    res.status(500).json({ error: "Face recognize batch failed" });
  }
});

// -------------------------
// Proxy to Ollama /api/generate (for web CORS)
// -------------------------
app.post("/ollama/generate", async (req, res) => {
  try {
    const { model, prompt, stream = false, options = {} } = req.body || {};
    if (!model || !prompt) return res.status(400).json({ error: "model and prompt are required." });

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

// -------------------------
// Start server
// -------------------------
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Local AI server running at http://${HOST}:${PORT}`);
});
