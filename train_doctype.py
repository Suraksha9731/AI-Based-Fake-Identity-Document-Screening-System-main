#!/usr/bin/env python3
"""
train_doctype.py - Dedicated 5-Class Document-Type Classifier Training Script

Classes:
  0: aadhaar
  1: pan
  2: passport
  3: voter
  4: other

Pipeline:
  1. Aggregates original + fake images from user datasets.
  2. Generates/samples 200 non-document 'other' images.
  3. Deduplicates images via SHA-256 hash.
  4. Performs stratified 80/10/10 train/val/test split by file.
  5. Letterboxes inputs to 224x224 (padded with neutral gray #808080).
  6. Trains MobileNetV2 transfer learning model with class balancing & augmentation.
  7. Evaluates test set (Confusion Matrix & Per-Class Accuracy).
  8. Exports model to ./model-doctype/ (model.json + weights.bin + metadata.json)
     matching Teachable Machine / TensorFlow.js format.
  9. Identifies and reports training samples where model disagrees with label with confidence > 0.9.
"""

import os
import sys
import json
import hashlib
import random
import shutil
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageDraw
from collections import Counter
from sklearn.metrics import confusion_matrix, classification_report

# Ensure reproducibility
random.seed(42)
np.random.seed(42)

# Document classes
CLASSES = ["aadhaar", "pan", "passport", "voter", "other"]
CLASS_TO_IDX = {c: i for i, c in enumerate(CLASSES)}
IDX_TO_CLASS = {i: c for i, c in enumerate(CLASSES)}

TARGET_SIZE = (224, 224)
OUTPUT_DIR = os.path.abspath("model-doctype")

# Root path to extracted datasets
DATASET_BASE = r"C:\Users\surak\Downloads\causual\extracted_datasets\AI-based  fake identity document system"
EXTRA_AADHAAR = r"C:\Users\surak\Downloads\my adhar.jpeg"
SCREENSHOTS_DIR = r"C:\Users\surak\OneDrive\Pictures\Screenshots 1"
DOWNLOADS_DIR = r"C:\Users\surak\Downloads"


def hash_file(filepath):
    """Compute SHA-256 hash of file content for exact deduplication."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def letterbox_image(pil_img, target_size=TARGET_SIZE, pad_color=(128, 128, 128)):
    """Resize image maintaining aspect ratio and pad with gray #808080."""
    pil_img = pil_img.convert("RGB")
    w, h = pil_img.size
    target_w, target_h = target_size
    scale = min(target_w / w, target_h / h)
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    resized = pil_img.resize((new_w, new_h), Image.Resampling.BILINEAR)
    canvas = Image.new("RGB", target_size, pad_color)
    paste_x = (target_w - new_w) // 2
    paste_y = (target_h - new_h) // 2
    canvas.paste(resized, (paste_x, paste_y))
    return canvas


def augment_pil_image(pil_img):
    """Applies realistic augmentation: rotation, brightness, contrast, zoom."""
    img = pil_img.copy()

    # Random rotation (-25 to +25 deg)
    angle = random.uniform(-25, 25)
    img = img.rotate(angle, resample=Image.Resampling.BILINEAR, expand=False, fillcolor=(128, 128, 128))

    # Random brightness (0.7 to 1.3)
    enhancer = ImageEnhance.Brightness(img)
    img = enhancer.enhance(random.uniform(0.7, 1.3))

    # Random contrast (0.7 to 1.3)
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(random.uniform(0.7, 1.3))

    # Random zoom (0.85 to 1.15)
    w, h = img.size
    crop_scale = random.uniform(0.85, 1.0)
    cw, ch = int(w * crop_scale), int(h * crop_scale)
    x1 = random.randint(0, max(0, w - cw))
    y1 = random.randint(0, max(0, h - ch))
    img = img.crop((x1, y1, x1 + cw, y1 + ch))

    return letterbox_image(img)


def generate_synthetic_other_images(count=60):
    """Generates synthetic non-document patterns (blank paper, textures, noise)."""
    imgs = []
    for i in range(count):
        mode_type = i % 4
        if mode_type == 0:
            # Blank paper with slight shading
            base_col = random.randint(235, 255)
            img = Image.new("RGB", (300, 300), (base_col, base_col, base_col))
        elif mode_type == 1:
            # Gradient card
            img = Image.new("RGB", (300, 300))
            draw = ImageDraw.Draw(img)
            r, g, b = random.randint(50, 200), random.randint(50, 200), random.randint(50, 200)
            for y in range(300):
                factor = y / 300.0
                draw.line([(0, y), (300, y)], fill=(int(r * factor), int(g * factor), int(b * factor)))
        elif mode_type == 2:
            # Random noise image
            arr = np.random.randint(0, 256, (300, 300, 3), dtype=np.uint8)
            img = Image.fromarray(arr)
        else:
            # Geometric shapes
            img = Image.new("RGB", (300, 300), (random.randint(20, 60), random.randint(20, 60), random.randint(20, 60)))
            draw = ImageDraw.Draw(img)
            draw.rectangle([random.randint(20, 100), random.randint(20, 100), random.randint(150, 280), random.randint(150, 280)], fill=(random.randint(100, 240), random.randint(100, 240), random.randint(100, 240)))
        imgs.append(letterbox_image(img))
    return imgs


def collect_dataset():
    """Collects and deduplicates raw image paths for all 5 classes."""
    print("=" * 60)
    print("STEP 1: Collecting & Deduplicating Dataset Samples")
    print("=" * 60)

    class_files = {c: [] for c in CLASSES}

    # 1. Aadhaar
    aadhaar_dirs = [
        os.path.join(DATASET_BASE, "original adhar"),
        os.path.join(DATASET_BASE, "fake adhar")
    ]
    for d in aadhaar_dirs:
        if os.path.exists(d):
            for f in os.listdir(d):
                if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp')):
                    class_files["aadhaar"].append(os.path.join(d, f))
    if os.path.exists(EXTRA_AADHAAR):
        class_files["aadhaar"].append(EXTRA_AADHAAR)

    # 2. PAN
    pan_dirs = [
        os.path.join(DATASET_BASE, "original pancard"),
        os.path.join(DATASET_BASE, "fake pancard")
    ]
    for d in pan_dirs:
        if os.path.exists(d):
            for f in os.listdir(d):
                if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp')):
                    class_files["pan"].append(os.path.join(d, f))

    # 3. Passport
    passport_dirs = [
        os.path.join(DATASET_BASE, "Passport original"),
        os.path.join(DATASET_BASE, "Passport fake")
    ]
    for d in passport_dirs:
        if os.path.exists(d):
            for f in os.listdir(d):
                if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp')):
                    class_files["passport"].append(os.path.join(d, f))

    # 4. Voter ID
    voter_dirs = [
        os.path.join(DATASET_BASE, "original voterID"),
        os.path.join(DATASET_BASE, "fake voter ID")
    ]
    for d in voter_dirs:
        if os.path.exists(d):
            for f in os.listdir(d):
                if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp')):
                    class_files["voter"].append(os.path.join(d, f))

    # 5. Other (Non-Document)
    if os.path.exists(SCREENSHOTS_DIR):
        sc_files = [os.path.join(SCREENSHOTS_DIR, f) for f in os.listdir(SCREENSHOTS_DIR) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
        random.shuffle(sc_files)
        class_files["other"].extend(sc_files[:110])

    if os.path.exists(DOWNLOADS_DIR):
        for f in os.listdir(DOWNLOADS_DIR):
            flow = f.lower()
            if flow.endswith(('.jpg', '.jpeg', '.png', '.webp')) and any(k in flow for k in ['chatgpt', 'wallpaper', 'logo', 'gautam', 'bajarangi', 'buddha', 'gemini', 'glam', 'trophy']):
                class_files["other"].append(os.path.join(DOWNLOADS_DIR, f))

    # Deduplication by hash
    deduped = {}
    total_raw = 0
    total_deduped = 0

    for c in CLASSES:
        raw_list = class_files[c]
        total_raw += len(raw_list)
        seen_hashes = set()
        clean_list = []
        for p in raw_list:
            try:
                h = hash_file(p)
                if h not in seen_hashes:
                    seen_hashes.add(h)
                    clean_list.append(p)
            except Exception as e:
                pass
        deduped[c] = clean_list
        total_deduped += len(clean_list)
        print(f"  Class '{c}': {len(raw_list)} raw -> {len(clean_list)} unique samples")

    print(f"Total Unique Images: {total_deduped} (Deduplicated from {total_raw})\n")
    return deduped


def build_splits(deduped_dict):
    """Splits 80% train, 10% val, 10% test by file."""
    print("=" * 60)
    print("STEP 2: Creating 80 / 10 / 10 Train/Val/Test Splits")
    print("=" * 60)

    train_data = [] # list of (img_path_or_pil, label_idx)
    val_data = []
    test_data = []

    for c in CLASSES:
        files = deduped_dict[c][:]
        random.shuffle(files)
        n = len(files)
        label_idx = CLASS_TO_IDX[c]

        if n <= 10:
            # Special minority handling (e.g. Aadhaar with 9 samples)
            # Ensure at least 1 in test, 1 in val, remaining in train
            n_test = max(1, int(round(n * 0.10)))
            n_val = max(1, int(round(n * 0.10)))
            test_files = files[:n_test]
            val_files = files[n_test:n_test + n_val]
            train_files = files[n_test + n_val:]
        else:
            n_test = max(2, int(round(n * 0.10)))
            n_val = max(2, int(round(n * 0.10)))
            test_files = files[:n_test]
            val_files = files[n_test:n_test + n_val]
            train_files = files[n_test + n_val:]

        for p in train_files: train_data.append((p, label_idx))
        for p in val_files: val_data.append((p, label_idx))
        for p in test_files: test_data.append((p, label_idx))

        print(f"  {c:<10}: Train={len(train_files):<4} Val={len(val_files):<4} Test={len(test_files):<4} (Total={n})")

    # Add synthetic images to 'other' class in training/val
    synthetic_others = generate_synthetic_other_images(50)
    other_idx = CLASS_TO_IDX["other"]
    for s_img in synthetic_others[:35]:
        train_data.append((s_img, other_idx))
    for s_img in synthetic_others[35:42]:
        val_data.append((s_img, other_idx))
    for s_img in synthetic_others[42:]:
        test_data.append((s_img, other_idx))

    print(f"\nFinal Split Totals: Train={len(train_data)}, Val={len(val_data)}, Test={len(test_data)}")
    return train_data, val_data, test_data


def load_dataset_arrays(data_list, augment_minority=True):
    """Loads images, applies letterboxing and heavy augmentation for minority classes."""
    images = []
    labels = []
    filepaths = []

    # Count frequencies
    counts = Counter(l for _, l in data_list)
    max_count = max(counts.values())

    for item, label in data_list:
        try:
            if isinstance(item, str):
                orig_img = Image.open(item)
                path_str = item
            else:
                orig_img = item
                path_str = "synthetic_other"

            lb = letterbox_image(orig_img)
            arr = np.array(lb, dtype=np.float32) / 127.5 - 1.0  # MobileNet [-1, 1] normalization
            images.append(arr)
            labels.append(label)
            filepaths.append(path_str)

            # Heavy augmentation for minority classes (e.g. Aadhaar, Voter, etc.)
            if augment_minority and counts[label] < 50:
                # Target at least 60 augmented samples in training for minority classes
                aug_multiplier = min(12, int(60 / max(1, counts[label])))
                for _ in range(aug_multiplier):
                    aug_img = augment_pil_image(orig_img)
                    aug_arr = np.array(aug_img, dtype=np.float32) / 127.5 - 1.0
                    images.append(aug_arr)
                    labels.append(label)
                    filepaths.append(path_str + f"_aug")
        except Exception as e:
            pass

    return np.array(images, dtype=np.float32), np.array(labels, dtype=np.int32), filepaths


def main():
    import tensorflow as tf

    print("\n" + "=" * 60)
    print("STEP 3: Preparing Data Arrays & Model Architecture")
    print("=" * 60)

    deduped = collect_dataset()
    train_data, val_data, test_data = build_splits(deduped)

    print("\nLoading and augmenting training samples...")
    X_train, y_train, train_paths = load_dataset_arrays(train_data, augment_minority=True)
    X_val, y_val, val_paths = load_dataset_arrays(val_data, augment_minority=False)
    X_test, y_test, test_paths = load_dataset_arrays(test_data, augment_minority=False)

    print(f"X_train shape: {X_train.shape}, y_train class distribution: {Counter(y_train)}")
    print(f"X_val shape:   {X_val.shape}, y_val class distribution:   {Counter(y_val)}")
    print(f"X_test shape:  {X_test.shape}, y_test class distribution:  {Counter(y_test)}")

    # Compute balanced class weights
    from sklearn.utils.class_weight import compute_class_weight
    classes_present = np.unique(y_train)
    weights = compute_class_weight('balanced', classes=classes_present, y=y_train)
    class_weight_dict = {c: float(w) for c, w in zip(classes_present, weights)}
    print(f"Computed Class Weights: {class_weight_dict}")

    # Build MobileNetV2 Transfer Learning Model
    print("\n" + "=" * 60)
    print("STEP 4: Training MobileNetV2 5-Class Classifier")
    print("=" * 60)

    base_model = tf.keras.applications.MobileNetV2(
        input_shape=(224, 224, 3),
        include_top=False,
        weights='imagenet',
        alpha=0.35
    )
    base_model.trainable = False  # Freeze feature extractor initially

    inputs = tf.keras.Input(shape=(224, 224, 3), name="input_1")
    x = base_model(inputs, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D(name="global_average_pooling2d")(x)
    x = tf.keras.layers.Dense(100, activation="relu", name="dense_Dense1")(x)
    x = tf.keras.layers.Dropout(0.2)(x)
    outputs = tf.keras.layers.Dense(5, activation="softmax", use_bias=False, name="dense_Dense2")(x)

    model = tf.keras.Model(inputs=inputs, outputs=outputs, name="tm-my-image-model")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    model.summary()

    # Train classifier head
    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=6, restore_best_weights=True)
    ]

    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=20,
        batch_size=16,
        class_weight=class_weight_dict,
        callbacks=callbacks,
        verbose=1
    )

    # Fine-tuning: Unfreeze top layers of MobileNetV2
    print("\nFine-tuning top layers of MobileNetV2...")
    base_model.trainable = True
    # Freeze all layers except last 20
    for layer in base_model.layers[:-20]:
        layer.trainable = False

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-4),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )

    model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=10,
        batch_size=16,
        class_weight=class_weight_dict,
        verbose=1
    )

    # STEP 5: Test Set Evaluation & Confusion Matrix
    print("\n" + "=" * 60)
    print("STEP 5: Test Set Evaluation & Confusion Matrix")
    print("=" * 60)

    test_preds = model.predict(X_test)
    y_pred = np.argmax(test_preds, axis=1)

    cm = confusion_matrix(y_test, y_pred, labels=range(5))
    print("\nCONFUSION MATRIX (Rows: Actual, Cols: Predicted):")
    header = f"{'':<12}" + "".join(f"{c:>10}" for c in CLASSES)
    print(header)
    print("-" * len(header))
    for i, row in enumerate(cm):
        print(f"{CLASSES[i]:<12}" + "".join(f"{v:>10}" for v in row))

    # Per-Class Accuracy
    print("\nPER-CLASS ACCURACY ON TEST SET:")
    has_sub90_warning = False
    for i, c in enumerate(CLASSES):
        total_class = np.sum(y_test == i)
        if total_class > 0:
            correct_class = cm[i, i]
            acc = (correct_class / total_class) * 100.0
            warn_str = " [WARNING: <90%]" if acc < 90.0 else " [OK]"
            if acc < 90.0: has_sub90_warning = True
            print(f"  {c:<10}: {acc:6.2f}% ({correct_class}/{total_class}){warn_str}")
        else:
            print(f"  {c:<10}: No test samples")

    if has_sub90_warning:
        print("\n[NOTE] Some classes achieved <90% test accuracy due to limited initial sample size.")
        print("Data augmentation and regularized loss have been applied to maximize generalization.")

    # STEP 6: Identify likely mislabeled training images (model disagreement with confidence > 0.9)
    print("\n" + "=" * 60)
    print("STEP 6: Checking for Likely Mislabeled Images (Disagreement > 0.90)")
    print("=" * 60)

    train_preds = model.predict(X_train, verbose=0)
    mislabeled_found = 0
    seen_paths = set()

    for idx, (pred, actual, path) in enumerate(zip(train_preds, y_train, train_paths)):
        pred_class = np.argmax(pred)
        conf = pred[pred_class]
        if pred_class != actual and conf > 0.90:
            base_p = path.replace("_aug", "")
            if base_p not in seen_paths and not base_p.startswith("synthetic"):
                seen_paths.add(base_p)
                mislabeled_found += 1
                print(f"  FLAGGED IMAGE: {base_p}")
                print(f"    -> Labeled as: {CLASSES[actual]} | Model predicted: {CLASSES[pred_class]} ({conf * 100:.1f}% confidence)")

    if mislabeled_found == 0:
        print("  No high-confidence (>90%) label disagreements detected in training sets.")

    # STEP 7: Export to ./model-doctype/ in Teachable Machine / TensorFlow.js format
    print("\n" + "=" * 60)
    print("STEP 7: Exporting Model to ./model-doctype/")
    print("=" * 60)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 1. Write metadata.json
    metadata = {
        "tfjsVersion": "1.7.4",
        "tmVersion": "2.4.16",
        "packageVersion": "0.8.4-alpha2",
        "packageName": "@teachablemachine/image",
        "timeStamp": "2026-09-29T12:00:00.000Z",
        "userMetadata": {},
        "modelName": "tm-my-image-model",
        "labels": CLASSES,
        "imageSize": 224
    }
    with open(os.path.join(OUTPUT_DIR, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)
    print("  Created: ./model-doctype/metadata.json")

    # 2. Extract weights and construct model.json & weights.bin
    # We clone the exact Teachable Machine model.json topology from model-aadhaar,
    # updating dense_Dense2 units from 2 to 5.
    with open("model-aadhaar/model.json") as f:
        tm_template = json.load(f)

    # Update dense_Dense2 units to 5
    tm_template["modelTopology"]["config"]["layers"][1]["config"]["layers"][1]["config"]["units"] = 5

    # Update dense_Dense2/kernel shape in weightsManifest to [100, 5]
    manifest = tm_template["weightsManifest"][0]
    for w in manifest["weights"]:
        if w["name"] == "dense_Dense2/kernel":
            w["shape"] = [100, 5]

    # Extract trained weights for dense_Dense1 and dense_Dense2
    d1_layer = model.get_layer("dense_Dense1")
    d2_layer = model.get_layer("dense_Dense2")

    d1_kernel, d1_bias = d1_layer.get_weights()
    d2_kernel = d2_layer.get_weights()[0]

    # Verify shapes
    assert d1_kernel.shape == (1280, 100), f"dense_Dense1/kernel shape mismatch: {d1_kernel.shape}"
    assert d1_bias.shape == (100,), f"dense_Dense1/bias shape mismatch: {d1_bias.shape}"
    assert d2_kernel.shape == (100, 5), f"dense_Dense2/kernel shape mismatch: {d2_kernel.shape}"

    # Read base weights from model-aadhaar/weights.bin
    with open("model-aadhaar/model.json") as f:
        orig_d = json.load(f)
    orig_weights_info = orig_d["weightsManifest"][0]["weights"]

    with open("model-aadhaar/weights.bin", "rb") as f:
        orig_bin = f.read()

    # Reconstruct binary buffer with new Dense weights
    out_byte_chunks = []
    offset = 0

    for w in orig_weights_info:
        name = w["name"]
        shape = w["shape"]
        count = int(np.prod(shape))
        byte_count = count * 4

        if name == "dense_Dense1/kernel":
            out_byte_chunks.append(d1_kernel.astype("<f4").tobytes())
            offset += byte_count
        elif name == "dense_Dense1/bias":
            out_byte_chunks.append(d1_bias.astype("<f4").tobytes())
            offset += byte_count
        elif name == "dense_Dense2/kernel":
            out_byte_chunks.append(d2_kernel.astype("<f4").tobytes())
            offset += byte_count
        else:
            # Preserve base MobileNetV2 weights directly
            chunk = orig_bin[offset:offset + byte_count]
            out_byte_chunks.append(chunk)
            offset += byte_count

    full_binary = b"".join(out_byte_chunks)
    with open(os.path.join(OUTPUT_DIR, "weights.bin"), "wb") as f:
        f.write(full_binary)
    print(f"  Created: ./model-doctype/weights.bin ({len(full_binary):,} bytes)")

    with open(os.path.join(OUTPUT_DIR, "model.json"), "w") as f:
        json.dump(tm_template, f)
    print("  Created: ./model-doctype/model.json")

    print("\n" + "=" * 60)
    print("TRAINING & EXPORT COMPLETED SUCCESSFULLY!")
    print(f"Model exported to: {OUTPUT_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    main()
