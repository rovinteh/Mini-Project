// index.js - Local AI + Face proxy server for MemoryBook 

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");

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
const OLLAMA_TEXT_MODEL = "deepseek-r1:7b"; // for text-only caption helper
// 视觉模型只负责看图描述（不再直接输出 JSON）
const OLLAMA_VISION_MODEL = "llava-phi3:latest"; // for real image-based caption

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

  // 统一空白
  result = result.replace(/\s+/g, " ").trim();
  let words = countWords(result);

  const MAX_WORDS = 28; // 最大允许字数

  // 1️⃣ 如果字数在范围内 → 完全保留 DeepSeek 的自然风格
  if (words <= MAX_WORDS) return result;

  // 2️⃣ 字数超过 MAX_WORDS → 先粗略截到 28 个词
  let tokens = result.split(/\s+/);
  let truncated = tokens.slice(0, MAX_WORDS).join(" ");

  // 3️⃣ 尝试智能收尾：不让句子断在一半
  const punctuations = [".", "!", "?", "。", "！", "？"];
  let lastPuncIndex = -1;

  for (const p of punctuations) {
    const idx = truncated.lastIndexOf(p);
    if (idx > lastPuncIndex) lastPuncIndex = idx;
  }

  if (lastPuncIndex > 0) {
    truncated = truncated.slice(0, lastPuncIndex + 1);
  }

  return truncated.trim();
}

// 🔹 把第三人称强行改成第一人称（防止 “I watched as she …” 这种）
function enforceFirstPerson(caption) {
  let result = String(caption || "");

  // she / her → I / my
  result = result.replace(/\b[Ss]he\b/g, "I");
  result = result.replace(/\bHer\b/g, "My");
  result = result.replace(/\bher\b/g, "my");

  // he / him 一般不会出现，出现就粗暴当成 I / me
  result = result.replace(/\b[Hh]e\b/g, "I");
  result = result.replace(/\b[Hh]im\b/g, "me");

  return result;
}

// 🔹 plush 专用：如果 draft 里写了 plush，但 caption 却说 dog / cat / bear / bunny → 统统改成 plush toy
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
  if (!draftLower.includes("plush")) return caption; // 用户没提 plush，就不要乱改

  let result = String(caption || "");
  ANIMAL_WORDS_FOR_PLUSH.forEach((word) => {
    const re = new RegExp("\\b" + word + "\\b", "gi");
    result = result.replace(re, "plush toy");
  });
  return result;
}

// 🔹 Hashtag 最小处理：去空、去重、小写、过滤敏感词、最多 5 个
const SENSITIVE_TAGS_REQUIRE_DRAFT = [
  "birthday",
  "cake",
  "cakes",
  "dessert",
  "desserts",
  "party",
  "celebration",
];

function adjustHashtags(hashtags, captionDraft) {
  let tags = Array.isArray(hashtags) ? [...hashtags] : [];

  tags = tags
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase().replace(/\s+/g, ""));

  // 去重
  tags = Array.from(new Set(tags));

  // 没有在 draft 里提到的敏感词，直接 ban 掉（避免幻觉蛋糕 / 生日）
  const draftLower = String(captionDraft || "").toLowerCase();
  tags = tags.filter((t) => {
    if (SENSITIVE_TAGS_REQUIRE_DRAFT.includes(t)) {
      return draftLower.includes(t);
    }
    return true;
  });

  return tags.slice(0, 5);
}

// 不想出现在 caption 里的「幻觉物件」
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

// 从 caption 里把这些词删掉
function removeBannedWords(text) {
  let result = String(text || "");
  for (const w of BANNED_BACKGROUND_WORDS) {
    const re = new RegExp("\\b" + w.replace(/\s+/g, "\\s+") + "\\b", "ig");
    result = result.replace(re, "");
  }
  // 再整理空白
  return result.replace(/\s+/g, " ").trim();
}

// -------------------------
// Helper: call Ollama (text → DeepSeek)
// -------------------------
async function callOllamaChatText(prompt) {
  const resp = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_TEXT_MODEL,
    messages: [{ role: "user", content: prompt }],
    // 让 DeepSeek 直接给 JSON（它会把 <think> 收在内部）
    format: "json",
    stream: false,
  });

  const msg = resp.data?.message?.content || "";
  return msg;
}

// -------------------------
// Helper: Vision – 单张图片描述（加强版：读招牌 + 禁止幻想）
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
- If there is any LARGE, CLEAR text on a sign, building, product, or sculpture
  (for example "BOH"), you MUST copy that text exactly once in your description,
  wrapped in quotes, like: the large white "BOH" sign on the hill.
- Completely ignore tiny or unclear background items, especially on tables or far away.
- If you are not 100% sure what an object is, DO NOT name it.
- If the main subject looks like a plush toy, and you are not 100% sure which animal it is,
  call it simply "a plush toy" or "a plush character", do NOT guess dog / cat / bear / bunny.

STRICT NO-GUESSING RULES:
- Do NOT talk about sounds (no "birds chirping", "music playing", etc.).
- Do NOT guess how many people are there if you cannot clearly count them.
- Do NOT invent activities like "people gathering around tables" unless the tables
  and people are clearly visible with chairs etc.
- Do NOT describe feelings or atmosphere ("inviting", "cozy", "romantic") —
  keep it purely visual.

STYLE:
- Use simple English, 1–2 short sentences.
- Mention key visible details of the main subject (shape, colors, text on signs).
- Do NOT mention "photo", "image", "camera" or "AI".
- Just give a neutral description of what is visible with your eyes.
`.trim(),
        images: [imageBase64],
      },
    ],
    stream: false,
  };

  const resp = await axios.post(`${OLLAMA_URL}/api/chat`, body);
  const msg = resp.data?.message?.content || "";
  return String(msg || "").trim();
}

// -------------------------
// Helper: Vision – 多张图片，逐张描述再合并
// -------------------------
async function callOllamaVisionDescribeMulti(imageBase64List, captionDraft) {
  const safeList = Array.isArray(imageBase64List)
    ? imageBase64List.filter(Boolean)
    : [];
  if (!safeList.length) return "";

  const total = safeList.length;
  const parts = [];

  for (let i = 0; i < total; i++) {
    try {
      const desc = await describeSingleImage(safeList[i], i + 1, total);
      if (desc) {
        parts.push(`Photo ${i + 1}: ${desc}`);
      }
    } catch (err) {
      console.log(
        `Vision describe error on photo ${i + 1}:`,
        err.message || err
      );
    }
  }

  if (!parts.length) return "";

  const combined = parts.join("\n");
  console.log("[VISION] Combined per-photo description:\n", combined);
  return combined;
}

// -------------------------
// /generatePostMeta  —— 多图版本
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
        visionDescription = await callOllamaVisionDescribeMulti(
          images,
          captionDraft
        );
        console.log(
          "[VISION] Description from llava (multi):",
          visionDescription
        );
      } catch (err) {
        console.log(
          "⚠️ Vision describe error, continue with text-only:",
          err.message || err
        );
      }
    }

    // 2) DeepSeek
    const systemInstruction = `
You are an assistant for a personal memory / social media app. 

You will receive:
- A short draft caption written by the user (may be empty).
- A neutral description of the photo(s) from another AI model (may be empty).

Your job is to:
1) Understand what is happening (people, place, objects, mood).
2) Write a warm, natural, first-person caption.
3) Suggest a few simple hashtags related ONLY to what you actually see.

GENERAL VISION RULES (VERY IMPORTANT):
- Treat everything as real life (no fantasy, no magic, no sci-fi).
- Only describe things that are clearly visible.
- If you are unsure about something, do NOT mention it.
- Do NOT exaggerate or invent:
  - Do NOT mention "friends", "we", "our group", "everyone" unless:
    • there are clearly TWO OR MORE people visible in the photos, OR
    • the USER draft explicitly mentions friends.
  - If there is exactly ONE clear face, treat it as a SOLO moment with "I / me / my".
  - Do NOT say "cafe", "restaurant", "local food spot" unless you clearly see:
    • an indoor dining area, OR tables + chairs + counter/menu/signs etc.
  - Do NOT say "lunch", "dinner", "breakfast" unless you clearly see a meal or food.
  - Do NOT say "trip", "travel", "holiday" unless there are obvious travel clues
    like luggage, landmarks, hotel, airplane view, or the user draft says it.
- When the background is unclear, keep the place description very neutral
  (e.g. "today", "this moment", "tonight", "here") instead of guessing.
- Never invent a story like "I woke up early" or "I spent the whole day with you guys"
  unless the user draft clearly says so.

CAPTION RULES (STYLE C: gentle, diary-like, suitable for everyone):
- Use only first person ("I", "me", "my", "we", "our").
- Forbidden words in the caption: "she", "her", "he", "him", and speaking directly to "you".
- The caption MUST feel like a note to myself, not a message to an audience.
- Absolutely do NOT speak to "you", "everyone", "guys", etc.
- Style: like a real person writing a short diary line:
  - warm, simple, slightly emotional or cute, but not dramatic.
  - suitable for any gender and any age.
- The caption should feel like I am gently describing this moment for myself.
- Length: roughly 8–20 words (shorter and simple is okay).
- 0–2 emojis only.
- Do NOT mention "photo", "picture", "image", "camera", or "AI".
- Do NOT include hashtags in the caption.

BIRTHDAY RULES:
- If description clearly shows birthday cake / candles / "Happy Birthday" text
  or number candles, caption MUST mention the birthday context.

HASHTAG RULES:
- Return 1–5 hashtags WITHOUT the "#" symbol.
- All hashtags must be directly related to objects in description.
- Only include food / drink / cafe / friends tags when description clearly supports them.
- All hashtags lowercase, no spaces, no spammy tags.

FRIEND TAG RULES:
- DO NOT invent names.
- DO NOT guess or create friend names.
- Only include names that the USER explicitly typed in the draft caption.
- Use first names only, no @ and no #.
- If the user did not provide names, return an empty array: friendTags: [].

EXTRA SAFETY RULE (VERY IMPORTANT):
- If the vision description mentions small background items like
  "matches", "box of matches", "pencils", "pens", "notebooks", "remote controls", etc.,
  you MUST ignore these words completely.
- They must NOT appear in the final caption or hashtags at all.

TEXT ON SIGNS:
- If the vision description contains quoted text from a sign or logo
  (for example "BOH"), you SHOULD mention this name once in either
  the caption or in one of the hashtags (or both), as long as it feels natural.

Return ONLY valid JSON, no explanation, no markdown fences:

{
  "caption": "string",
  "hashtags": ["tag1","tag2"],
  "friendTags": ["name1","name2"]
}
`.trim();

    const totalPhotos = images.length;

    const combinedPrompt = `${systemInstruction}

Total number of photos in this memory: ${totalPhotos}

User draft caption (may be empty):
"${captionDraft || "(empty)"}"

Neutral description of the photo(s) from a vision model (may be empty):
"${visionDescription || "(no description)"}"

Using BOTH the user draft and the description, generate the final caption and hashtags.
Always obey ALL the rules above.
`;

    let rawContent;
    try {
      rawContent = await callOllamaChatText(combinedPrompt);
    } catch (err) {
      console.error(
        "⚠️ Ollama DeepSeek error in /generatePostMeta, using fallback:",
        err.message || err
      );
      rawContent = JSON.stringify({
        caption: captionDraft || "",
        hashtags: [],
        friendTags: [],
      });
    }

    console.log("[VISION] Raw content from DeepSeek:", rawContent);

    // Try to parse JSON from DeepSeek output
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

    // Normalize raw model output
    let caption = String(parsed.caption || captionDraft || "").trim();
    let hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((h) => String(h).trim()).filter(Boolean)
      : [];

    // 先硬过滤掉我们不想要的幻觉词
    caption = removeBannedWords(caption);
    // 再强制变成第一人称
    caption = enforceFirstPerson(caption);
    // plush + dog/cat/bear/bunny → plush toy
    caption = fixPlushAnimalHallucination(caption, captionDraft);

    // ---- ENFORCE MINIMAL RULES HERE ----
    caption = normalizeCaptionLength(caption, captionDraft);
    hashtags = adjustHashtags(hashtags, captionDraft);

    // ✅ 只有当 draft 里本来就提到 birthday，才强制加 birthday hashtag
    if (
      caption.toLowerCase().includes("birthday") &&
      String(captionDraft || "").toLowerCase().includes("birthday")
    ) {
      if (!hashtags.includes("birthday")) {
        hashtags.unshift("birthday");
      }
    }

    // -------- Face recognition for friendTags --------
    let faceMatches = [];
    if (images.length > 0) {
      try {
        const faceResp = await recognizeFace(images[0]);
        faceMatches = Array.isArray(faceResp.matches) ? faceResp.matches : [];
        console.log("[VISION] Face matches for friend tags:", faceMatches);
      } catch (err) {
        console.log("Face recognition in /generatePostMeta failed:", err);
      }
    }

    const faceNames = faceMatches
      .map((m) => (m.name || "").trim())
      .filter(Boolean);

    const friendTagsMerged = Array.from(new Set(faceNames));

    const cleaned = {
      caption,
      hashtags,
      friendTags: friendTagsMerged,
    };

    console.log("[VISION] Cleaned content:", cleaned);
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
    return res
      .status(400)
      .json({ error: "name and imageBase64 are required." });
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
    console.log("✅ /faces/recognize -> Python:", pyResp);

    res.json({
      ok: pyResp.ok !== false,
      matches: Array.isArray(pyResp.matches) ? pyResp.matches : [],
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
