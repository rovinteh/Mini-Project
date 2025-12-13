# face_service.py
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import base64, io, os, uuid, json
from PIL import Image
from deepface import DeepFace

FACES_DIR = "faces_db"
META_FILE = "faces_meta.json"

os.makedirs(FACES_DIR, exist_ok=True)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------- models -------------

class RegisterRequest(BaseModel):
    personId: str
    name: str
    imageBase64: str

class RecognizeRequest(BaseModel):
    imageBase64: str

class RecognizeBatchRequest(BaseModel):
    imageBase64List: List[str]
    threshold: Optional[float] = None  # default uses THRESHOLD below

# ------------- helpers -------------

def load_meta():
    if not os.path.exists(META_FILE):
        return {}
    with open(META_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_meta(meta):
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

def normalize_base64(data: str) -> str:
    if not data:
        return ""
    # handle "data:image/jpeg;base64,...."
    if "," in data:
        _, data = data.split(",", 1)
    return data.strip()

def save_base64_image(b64_str, path):
    b64_str = normalize_base64(b64_str)
    img_bytes = base64.b64decode(b64_str)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img.save(path, format="JPEG")

def deepface_find_best(tmp_file: str, threshold: float):
    """
    Return a single best match in your format OR [].
    """
    dfs = DeepFace.find(
        img_path=tmp_file,
        db_path=FACES_DIR,
        model_name="Facenet512",
        enforce_detection=False,
    )

    if not dfs or len(dfs[0]) == 0:
        return []

    df = dfs[0].sort_values(by="distance", ascending=True)
    best = df.iloc[0]
    distance = float(best["distance"])
    identity_path = str(best["identity"])

    # identity_path ~ faces_db/personId/file.jpg
    rel = os.path.relpath(identity_path, FACES_DIR)
    parts = rel.split(os.sep)
    person_id = parts[0] if parts else "unknown"

    meta = load_meta()
    name = meta.get(person_id, person_id)

    if distance > threshold:
        return []

    return [
        {
            "box": {"x": 0, "y": 0, "width": 1, "height": 1},
            "personId": person_id,
            "name": name,
            "distance": distance,
        }
    ]

# ------------- endpoints -------------

@app.post("/faces/register")
def register_face(req: RegisterRequest):
    """
    Save the image into faces_db/personId and remember mapping personId -> name.
    DeepFace will build embeddings from the folder later.
    """
    meta = load_meta()

    person_folder = os.path.join(FACES_DIR, req.personId)
    os.makedirs(person_folder, exist_ok=True)

    filename = f"{uuid.uuid4().hex}.jpg"
    img_path = os.path.join(person_folder, filename)
    save_base64_image(req.imageBase64, img_path)

    meta[req.personId] = req.name
    save_meta(meta)

    return {"ok": True, "personId": req.personId, "name": req.name}

@app.post("/faces/recognize")
def recognize_face(req: RecognizeRequest):
    """
    Use DeepFace to find closest face in faces_db.
    Returns { matches: [...] }
    """
    if not os.listdir(FACES_DIR):
        return {"matches": []}

    tmp_file = f"tmp_{uuid.uuid4().hex}.jpg"
    save_base64_image(req.imageBase64, tmp_file)

    try:
        THRESHOLD = 0.8
        matches = deepface_find_best(tmp_file, THRESHOLD)
        return {"matches": matches}
    finally:
        if os.path.exists(tmp_file):
            os.remove(tmp_file)

@app.post("/faces/recognize_batch")
def recognize_face_batch(req: RecognizeBatchRequest):
    """
    Multiple images in one request.
    Returns:
      {
        ok: true,
        count: N,
        results: [{ index, matches, error? }]
      }
    """
    if not os.listdir(FACES_DIR):
        return {"ok": True, "count": 0, "results": []}

    MAX_IMAGES = 8  # keep your payload safe
    imgs = [x for x in (req.imageBase64List or []) if x][:MAX_IMAGES]

    THRESHOLD = float(req.threshold) if req.threshold is not None else 0.8

    results = []
    for idx, b64 in enumerate(imgs):
        tmp_file = f"tmp_{uuid.uuid4().hex}.jpg"
        try:
            save_base64_image(b64, tmp_file)
            matches = deepface_find_best(tmp_file, THRESHOLD)
            results.append({"index": idx, "matches": matches})
        except Exception as e:
            results.append({"index": idx, "matches": [], "error": str(e)})
        finally:
            if os.path.exists(tmp_file):
                os.remove(tmp_file)

    return {"ok": True, "count": len(imgs), "results": results}
