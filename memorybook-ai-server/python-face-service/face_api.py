# face_api.py — strict face register + multi-face recognize service
#
# Requirements:
#   pip install fastapi uvicorn[standard] face_recognition pillow numpy
#
# Run:
#   py -3.11 -m uvicorn face_api:app --reload --port 8000

import os
import io
import base64
import json
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
import numpy as np
import face_recognition

# ---------- Config ----------
FACES_DB_DIR = os.path.join(os.path.dirname(__file__), "faces_db")
ENCODINGS_FILE = os.path.join(FACES_DB_DIR, "encodings.json")
os.makedirs(FACES_DB_DIR, exist_ok=True)

app = FastAPI()

# ---------- Models ----------
class RegisterRequest(BaseModel):
  name: str
  imageBase64: str

class RecognizeRequest(BaseModel):
  imageBase64: str
  threshold: Optional[float] = 0.6

class RegisterResponse(BaseModel):
  ok: bool
  name: str
  encodingsCount: int

class Match(BaseModel):
  name: str
  distance: float

class FaceMatches(BaseModel):
  faceIndex: int
  matches: List[Match]

class RecognizeResponse(BaseModel):
  ok: bool
  faces: List[FaceMatches]

# ---------- Helpers ----------
def decode_base64_image(data: str) -> np.ndarray:
  if not data:
    raise HTTPException(status_code=400, detail="Empty imageBase64")

  if "," in data:
    _, data = data.split(",", 1)

  try:
    img_bytes = base64.b64decode(data)
  except Exception as e:
    raise HTTPException(status_code=400, detail=f"Invalid base64 data: {e}")

  try:
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
  except Exception as e:
    raise HTTPException(status_code=400, detail=f"Invalid image data: {e}")

  return np.array(img)

def load_encodings() -> list:
  if not os.path.exists(ENCODINGS_FILE):
    return []
  try:
    with open(ENCODINGS_FILE, "r", encoding="utf-8") as f:
      return json.load(f)
  except Exception:
    return []

def save_encodings(records: list):
  os.makedirs(FACES_DB_DIR, exist_ok=True)
  with open(ENCODINGS_FILE, "w", encoding="utf-8") as f:
    json.dump(records, f, ensure_ascii=False)

def best_matches_for_encoding(encoding: np.ndarray, records: list, threshold: float) -> List[Match]:
  known_encodings = [np.array(r["encoding"], dtype="float32") for r in records]
  known_names = [r["name"] for r in records]

  distances = face_recognition.face_distance(known_encodings, encoding)

  best_by_name = {}
  for name, dist in zip(known_names, distances):
    dist = float(dist)
    if dist <= threshold:
      if (name not in best_by_name) or (dist < best_by_name[name]):
        best_by_name[name] = dist

  matches = [Match(name=n, distance=d) for n, d in best_by_name.items()]
  matches.sort(key=lambda m: m.distance)
  return matches

# ---------- /faces/register ----------
@app.post("/faces/register", response_model=RegisterResponse)
def register_face(req: RegisterRequest):
  img = decode_base64_image(req.imageBase64)

  boxes = face_recognition.face_locations(img)
  if not boxes:
    raise HTTPException(status_code=400, detail="No face detected in image")

  # STRICT: exactly one face for registration
  if len(boxes) != 1:
    raise HTTPException(
      status_code=400,
      detail="Please register with exactly ONE clear face (no group photo)."
    )

  encs = face_recognition.face_encodings(img, boxes)
  if not encs:
    raise HTTPException(status_code=400, detail="Failed to compute encodings")

  encoding_list = encs[0].tolist()

  records = load_encodings()
  records.append({
    "name": req.name.strip(),
    "encoding": encoding_list,
  })
  save_encodings(records)

  person_dir = os.path.join(FACES_DB_DIR, req.name.strip())
  os.makedirs(person_dir, exist_ok=True)
  ts = datetime.now().strftime("%Y%m%d_%H%M%S")
  img_path = os.path.join(person_dir, f"{ts}.jpg")
  Image.fromarray(img).save(img_path, format="JPEG")

  enc_count = sum(1 for r in records if r.get("name") == req.name.strip())
  return RegisterResponse(ok=True, name=req.name.strip(), encodingsCount=enc_count)

# ---------- /faces/recognize ----------
@app.post("/faces/recognize", response_model=RecognizeResponse)
def recognize_face(req: RecognizeRequest):
  img = decode_base64_image(req.imageBase64)

  boxes = face_recognition.face_locations(img)
  if not boxes:
    return RecognizeResponse(ok=True, faces=[])

  encs = face_recognition.face_encodings(img, boxes)
  if not encs:
    return RecognizeResponse(ok=True, faces=[])

  records = load_encodings()
  if not records:
    return RecognizeResponse(ok=True, faces=[])

  threshold = req.threshold if req.threshold is not None else 0.6

  faces_out: List[FaceMatches] = []
  for i, enc in enumerate(encs):
    matches = best_matches_for_encoding(enc, records, threshold)
    faces_out.append(FaceMatches(faceIndex=i, matches=matches))

  return RecognizeResponse(ok=True, faces=faces_out)
