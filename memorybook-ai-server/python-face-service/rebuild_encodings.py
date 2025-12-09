# rebuild_encodings.py
# 作用：根据 faces_db 里现在还存在的 face_*.jpg，重新生成 encodings.npy

import os
import glob
import numpy as np
import face_recognition

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FACES_DB_DIR = os.path.join(BASE_DIR, "faces_db")

def rebuild_for_person(person_name: str):
    person_dir = os.path.join(FACES_DB_DIR, person_name)
    if not os.path.isdir(person_dir):
        return

    print(f"\n=== Rebuilding encodings for {person_name} ===")
    image_paths = sorted(
        glob.glob(os.path.join(person_dir, "face_*.jpg"))
    ) + sorted(
        glob.glob(os.path.join(person_dir, "face_*.png"))
    )

    encodings = []

    for img_path in image_paths:
        print(f"  -> processing {os.path.basename(img_path)}")
        img = face_recognition.load_image_file(img_path)
        face_encs = face_recognition.face_encodings(img)

        if not face_encs:
            print("     !! no face detected, skip")
            continue

        # 一张图只取第一个脸
        encodings.append(face_encs[0])

    enc_path = os.path.join(person_dir, "encodings.npy")

    if encodings:
        arr = np.stack(encodings, axis=0)
        np.save(enc_path, arr)
        print(f"  saved {arr.shape[0]} encodings -> {enc_path}")
    else:
        # 这个人没有任何有效图片了，就把旧的 encodings.npy 删掉
        if os.path.exists(enc_path):
            os.remove(enc_path)
            print(f"  removed old encodings file: {enc_path}")
        else:
            print("  no images & no encodings, nothing to do.")

def main():
    if not os.path.isdir(FACES_DB_DIR):
        print("faces_db folder not found:", FACES_DB_DIR)
        return

    persons = [
        name for name in os.listdir(FACES_DB_DIR)
        if os.path.isdir(os.path.join(FACES_DB_DIR, name))
    ]

    if not persons:
        print("No person folders found in faces_db.")
        return

    for p in persons:
        rebuild_for_person(p)

if __name__ == "__main__":
    main()
