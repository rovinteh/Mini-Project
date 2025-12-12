// index.js - Local AI + Face proxy server for MemoryBook

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

// ---- Ollama config (adjust if needed) ----
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
// DeepSeek 专门用来“改写 + 输出 JSON”
const OLLAMA_TEXT_MODEL = "deepseek-r1:7b"; // text-only caption helper
// 视觉模型只负责看图描述（不再直接输出 JSON）
const OLLAMA_VISION_MODEL = "llava-phi3:latest"; // real image-based caption

// -------------------------
// Small helpers
// -------------------------
function countWords(str) {
  return String(str || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

// 🔹 最稳健的 caption 剪裁：不加句子、不改风格、不截断半句
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

// 🔹 third person → first person
function enforceFirstPerson(caption) {
  let result = String(caption || "");

  result = result.replace(/\b[Ss]he\b/g, "I");
  result = result.replace(/\bHer\b/g, "My");
  result = result.replace(/\bher\b/g, "my");

  result = result.replace(/\b[Hh]e\b/g, "I");
  result = result.replace(/\b[Hh]im\b/g, "me");

  return result;
}

const ANIMAL_WORDS_FOR_PLUSH = [
  "dog","dogs","puppy","puppies","cat","cats","kitten","kittens",
  "bear","bears","bunny","bunnies","rabbit","rabbits",
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

// 🔹 Hashtag 最小处理：去空、去重、小写、过滤敏感词、最多 5 个
const SENSITIVE_TAGS_REQUIRE_DRAFT = [
  "birthday","cake","cakes","dessert","desserts","party","celebration","boh",
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
  "matches","matchbox","box of matches","pencil","pencils","pen","pens",
  "marker","markers","notebook","notebooks","remote control","remote",
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
  "taking notes","take notes","doing homework","do homework","studying",
  "study session","working on my notes","working on notes","working on homework",
  "working on assignments","doing my assignment","doing assignments",
  "preparing for exams","studying for exams",
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

// ✅ Safe fallback hashtags from USER draft only (no hallucination)
function fallbackTagsFromDraft(captionDraft, max = 3) {
  const draft = String(captionDraft || "").trim();
  if (!draft) return [];

  const cleaned = draft
    .toLowerCase()
    .replace(/[#]/g, " ")
    .split(/[,;\n\r\t ]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3) // avoid "a", "i"
    .filter((t) => /^[a-z0-9]+$/i.test(t)); // simple safe tags only

  return Array.from(new Set(cleaned)).slice(0, max);
}

// -------------------------
// Helper: call Ollama (text → DeepSeek)
// -------------------------
async function callOllamaChatText(prompt) {
  const resp = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_TEXT_MODEL,
    messages: [{ role: "user", content: prompt }],
    format: "json",
    stream: false,
  });

  return resp.data?.message?.content || "";
}

// -------------------------
// Helper: Vision – single image describe
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
- If there is any LARGE, CLEAR text on a sign, building, product, or sculpture:
  • Only mention the text if it is perfectly readable and unambiguous.
  • If you see the word "BOH" anywhere, COMPLETELY IGNORE it and do NOT mention it.
  • If you are not 100% sure of every letter, DO NOT mention any text at all.
- Completely ignore tiny or unclear background items, especially on tables or far away.
- If you are not 100% sure what an object is, DO NOT name it.
- If the main subject looks like a plush toy, and you are not 100% sure which animal it is,
  call it simply "a plush toy" or "a plush character", do NOT guess dog / cat / bear / bunny.

STRICT NO-GUESSING RULES:
- Do NOT talk about sounds.
- Do NOT guess how many people are there if you cannot clearly count them.
- Do NOT invent activities unless clearly visible.
- Do NOT describe feelings or atmosphere.
- NEVER guess text content of far away signs.

STYLE:
- Use simple English, 1–2 short sentences.
- Do NOT mention "photo", "image", "camera" or "AI".
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
// Helper: Vision – multi images describe
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

    // 2) DeepSeek
    const systemInstruction = `
You are an assistant for a personal memory / social media app.

Return ONLY valid JSON:
{
  "caption": "string",
  "hashtags": ["tag1","tag2"],
  "friendTags": ["name1","name2"]
}

Rules:
- Caption: warm, first-person, diary-like, 8–20 words, 0–2 emojis, no hashtags inside caption.
- Hashtags: 1–5 tags, lowercase, no spaces, no guessing.
- Friend tags: DO NOT invent names; return [] unless user typed names in draft.
`.trim();

    const combinedPrompt = `${systemInstruction}

User draft caption (may be empty):
"${captionDraft || "(empty)"}"

Neutral description of the photo(s) from a vision model (may be empty):
"${visionDescription || "(no description)"}"
`;

    let rawContent;
    try {
      rawContent = await callOllamaChatText(combinedPrompt);
    } catch (err) {
      console.error("⚠️ Ollama DeepSeek error in /generatePostMeta, using fallback:", err.message || err);
      rawContent = JSON.stringify({ caption: captionDraft || "", hashtags: [], friendTags: [] });
    }

    console.log("[VISION] Raw content from DeepSeek:", rawContent);

    // Parse DeepSeek JSON
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
      console.log("⚠️ Failed to parse JSON from DeepSeek, using fallback:", err);
    }

    // Normalize model output
    let caption = String(parsed.caption || captionDraft || "").trim();
    let hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((h) => String(h).trim()).filter(Boolean)
      : [];

    // Cleanup caption
    caption = removeBannedWords(caption);
    caption = removeBannedActivities(caption, captionDraft);
    caption = removeBrandTextIfNotInDraft(caption, captionDraft);
    caption = enforceFirstPerson(caption);
    caption = fixPlushAnimalHallucination(caption, captionDraft);

    caption = normalizeCaptionLength(caption, captionDraft);
    hashtags = adjustHashtags(hashtags, captionDraft);

    // ✅ If AI gives zero hashtags, fallback to USER draft keywords only
    if (hashtags.length === 0) {
      const fallback = fallbackTagsFromDraft(captionDraft, 3);
      if (fallback.length > 0) hashtags = fallback;
    }

    // -------- Face recognition for friendTags (STRICT multi-face) --------
    const FACE_THRESHOLD = 0.37; // strict
    const MIN_GAP = 0.06;
    const MAX_TAGS = 5;

    let friendTagsMerged = [];

    if (images.length > 0) {
      try {
        const faceResp = await recognizeFace(images[0], FACE_THRESHOLD);
        const faces = Array.isArray(faceResp.faces) ? faceResp.faces : [];

        // ✅ PROOF: print full distances (0.xxxxxx)
        console.log(
          "[VISION] FaceResp FULL:\n",
          util.inspect(faceResp, { depth: null, colors: true })
        );
        console.log("[VISION] FaceResp JSON:\n", JSON.stringify(faceResp, null, 2));

        for (const f of faces) {
          const matches = Array.isArray(f.matches) ? f.matches : [];
          console.log(
            `Face ${f.faceIndex} distances:`,
            matches.map((m) => `${m.name}:${Number(m.distance).toFixed(6)}`).join(", ")
          );
        }

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

          // GAP RULE (only use top match per face if clearly better than next)
          const top = candidates[0];
          const next = candidates[1];
          if (next && Math.abs(next.distance - top.distance) < MIN_GAP) {
            continue; // ambiguous
          }

          pickedNames.push(top.name);
          if (pickedNames.length >= MAX_TAGS) break;
        }

        friendTagsMerged = Array.from(new Set(pickedNames)).slice(0, MAX_TAGS);
      } catch (err) {
        console.log("Face recognition in /generatePostMeta failed:", err);
      }
    }

    const cleaned = {
      caption,
      hashtags,
      friendTags: friendTagsMerged,
    };

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
// Start server
// -------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Local AI server running at http://localhost:${PORT}`);
});
