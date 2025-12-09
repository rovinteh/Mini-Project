# face_service.py
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from typing import List
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

# ------------- helpers -------------

def load_meta():
    if not os.path.exists(META_FILE):
        return {}
    with open(META_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_meta(meta):
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

def save_base64_image(b64_str, path):
    img_bytes = base64.b64decode(b64_str)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img.save(path, format="JPEG")

# ------------- endpoints -------------

@app.post("/faces/register")
def register_face(req: RegisterRequest):
    """
    Save the image into faces_db and remember mapping personId -> name.
    DeepFace will build embeddings from the folder later.
    """
    meta = load_meta()
    # each person gets a subfolder
    person_folder = os.path.join(FACES_DIR, req.personId)
    os.makedirs(person_folder, exist_ok=True)

    filename = f"{uuid.uuid4().hex}.jpg"
    img_path = os.path.join(person_folder, filename)
    save_base64_image(req.imageBase64, img_path)

    # store display name
    meta[req.personId] = req.name
    save_meta(meta)

    return {"ok": True, "personId": req.personId, "name": req.name}

@app.post("/faces/recognize")
def recognize_face(req: RecognizeRequest):
    """
    Use DeepFace to find closest face in faces_db.
    """
    if not os.listdir(FACES_DIR):
        return {"matches": []}

    tmp_file = f"tmp_{uuid.uuid4().hex}.jpg"
    save_base64_image(req.imageBase64, tmp_file)

    try:
        # model_name can be "Facenet512", "ArcFace", etc.
        dfs = DeepFace.find(
            img_path=tmp_file,
            db_path=FACES_DIR,
            model_name="Facenet512",
            enforce_detection=False
        )

        # DeepFace.find can return list of DataFrames (one per model)
        if not dfs or len(dfs[0]) == 0:
            return {"matches": []}

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

        # you can tune this threshold
        THRESHOLD = 0.8
        if distance > THRESHOLD:
            return {"matches": []}

        return {
            "matches": [
                {
                    "box": {"x": 0, "y": 0, "width": 1, "height": 1},
                    "personId": person_id,
                    "name": name,
                    "distance": distance,
                }
            ]
        }
    finally:
        if os.path.exists(tmp_file):
            os.remove(tmp_file)
