# Dedicated Document Type Classifier Model

Place your exported **Teachable Machine (Image Project)** model files here:
1. `model.json`
2. `metadata.json`
3. `weights.bin`

### Required Classes (5 Classes)
Ensure your Teachable Machine project has these 5 classes:
- `aadhaar`
- `pan`
- `passport`
- `voter`
- `other`

Trained on both original and fake samples of each type so fakes are correctly identified by document type.
