// memorybook-ai-server/face-service.js
// --------------------------------------------------------------
// Helper functions to call the Python face API at:
//   http://127.0.0.1:8000
//
// Endpoints used:
//   POST /faces/detect     { imageBase64List: [...] }
//   POST /faces/register   { name, imageBase64 }
//   POST /faces/recognize  { imageBase64, threshold? }
// --------------------------------------------------------------

const axios = require("axios");

const PYTHON_FACE_API = "http://127.0.0.1:8000";

// Detect in a LIST of images – used by your React Native "Remember this face"
async function detectFacesInList(imageBase64List) {
  if (!Array.isArray(imageBase64List) || imageBase64List.length === 0) {
    return { hasFace: false, faceIndex: null };
  }

  try {
    const resp = await axios.post(`${PYTHON_FACE_API}/faces/detect`, {
      imageBase64List,
    });

    // Python returns: { hasFace, faceIndex }
    return resp.data;
  } catch (err) {
    console.error("❌ detectFacesInList error:", err.message || err);
    return { hasFace: false, faceIndex: null };
  }
}

// Register a single face under a name -> faces_db/<name>
async function registerFace(name, imageBase64) {
  if (!imageBase64) {
    throw new Error("imageBase64 is required");
  }
  if (!name) {
    name = "unknown";
  }

  try {
    const resp = await axios.post(`${PYTHON_FACE_API}/faces/register`, {
      name,
      imageBase64,
    });

    // { ok, name, encodingsCount }
    return resp.data;
  } catch (err) {
    console.error("❌ registerFace error:", err.message || err);
    throw err;
  }
}

// Recognize a face using only encodings in faces_db
async function recognizeFace(imageBase64, threshold = 0.6) {
  if (!imageBase64) {
    return { ok: false, matches: [] };
  }

  try {
    const resp = await axios.post(`${PYTHON_FACE_API}/faces/recognize`, {
      imageBase64,
      threshold,
    });

    // { ok, matches: [ { name, distance } ] }
    return resp.data;
  } catch (err) {
    console.error("❌ recognizeFace error:", err.message || err);
    return { ok: false, matches: [] };
  }
}

module.exports = {
  detectFacesInList,
  registerFace,
  recognizeFace,
};
