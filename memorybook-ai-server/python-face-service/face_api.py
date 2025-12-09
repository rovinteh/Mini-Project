# face_api.py  — simple face register + recognize service
#
# 需要的 pip 包：
#   pip install fastapi uvicorn[standard] face_recognition pillow numpy
#
# 启动：
#   py -3.11 -m uvicorn face_api:app --reload --port 8000
#
# Node 那边的 face-service.js 会调用：
#   POST http://127.0.0.1:8000/faces/register
#   POST http://127.0.0.1:8000/faces/recognize

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

# ---------- 配置 ----------
FACES_DB_DIR = os.path.join(os.path.dirname(__file__), "faces_db")
ENCODINGS_FILE = os.path.join(FACES_DB_DIR, "encodings.json")

os.makedirs(FACES_DB_DIR, exist_ok=True)

app = FastAPI()


# ---------- Pydantic 模型 ----------
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


class RecognizeResponse(BaseModel):
  ok: bool
  matches: List[Match]


# ---------- 工具函数 ----------

def decode_base64_image(data: str) -> np.ndarray:
  """
  把 base64 字符串变成 numpy 图像 (RGB).
  支持 "data:image/jpeg;base64,xxxx" 这种前缀。
  """
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


def load_encodings():
  if not os.path.exists(ENCODINGS_FILE):
    return []

  try:
    with open(ENCODINGS_FILE, "r", encoding="utf-8") as f:
      data = json.load(f)
    return data
  except Exception:
    # 文件坏掉就直接重置
    return []


def save_encodings(records):
  os.makedirs(FACES_DB_DIR, exist_ok=True)
  with open(ENCODINGS_FILE, "w", encoding="utf-8") as f:
    json.dump(records, f)


# ---------- API: /faces/register ----------

@app.post("/faces/register", response_model=RegisterResponse)
def register_face(req: RegisterRequest):
  """
  把一张脸注册进数据库：
  - 提取第一张人脸 encoding
  - 存到 encodings.json
  - 顺便把原图存在 faces_db/<name>/timestamp.jpg
  """
  # 1) decode 图片
  img = decode_base64_image(req.imageBase64)

  # 2) 提取人脸
  boxes = face_recognition.face_locations(img)
  if not boxes:
    raise HTTPException(status_code=400, detail="No face detected in image")

  encs = face_recognition.face_encodings(img, boxes)
  if not encs:
    raise HTTPException(status_code=400, detail="Failed to compute encodings")

  # 只取第一张脸
  encoding = encs[0]
  encoding_list = encoding.tolist()

  # 3) 载入旧记录, 追加
  records = load_encodings()
  records.append({
    "name": req.name,
    "encoding": encoding_list,
  })
  save_encodings(records)

  # 4) 保存原图
  person_dir = os.path.join(FACES_DB_DIR, req.name)
  os.makedirs(person_dir, exist_ok=True)
  ts = datetime.now().strftime("%Y%m%d_%H%M%S")
  img_path = os.path.join(person_dir, f"{ts}.jpg")
  Image.fromarray(img).save(img_path, format="JPEG")

  # 统计这个 name 有多少条 encoding
  enc_count = sum(1 for r in records if r.get("name") == req.name)

  return RegisterResponse(ok=True, name=req.name, encodingsCount=enc_count)


# ---------- API: /faces/recognize ----------

@app.post("/faces/recognize", response_model=RecognizeResponse)
def recognize_face(req: RecognizeRequest):
  """
  用新的照片识别人：
  - 提取第一张脸 encoding
  - 和 encodings.json 里的所有向量比较欧氏距离
  - 小于阈值的就视为匹配，按距离从近到远排序
  """
  img = decode_base64_image(req.imageBase64)

  boxes = face_recognition.face_locations(img)
  if not boxes:
    # 没有脸也不是 error，只是没有匹配
    return RecognizeResponse(ok=True, matches=[])

  encs = face_recognition.face_encodings(img, boxes)
  if not encs:
    return RecognizeResponse(ok=True, matches=[])

  encoding = encs[0]

  records = load_encodings()
  if not records:
    return RecognizeResponse(ok=True, matches=[])

  known_encodings = [np.array(r["encoding"], dtype="float32") for r in records]
  known_names = [r["name"] for r in records]

  # 计算距离
  distances = face_recognition.face_distance(known_encodings, encoding)
  threshold = req.threshold if req.threshold is not None else 0.6

  matches_dict = {}
  for name, dist in zip(known_names, distances):
    if dist <= threshold:
      # 同一个名字可能多条 encoding，取最小距离
      if (name not in matches_dict) or (dist < matches_dict[name]):
        matches_dict[name] = float(dist)

  matches_list = [
    Match(name=n, distance=d) for n, d in matches_dict.items()
  ]
  matches_list.sort(key=lambda m: m.distance)

  return RecognizeResponse(ok=True, matches=matches_list)
