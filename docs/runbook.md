# SURYAKAVACH Operator Runbook

## Overview

SURYAKAVACH is an indigenous solar flare nowcasting, forecasting, and radiation impact analysis console for ISRO's Aditya-L1 payloads (SoLEXS, HEL1OS, SUIT, MAG).

---

## 1. Local Development & Operational Boot

### Backend Setup
1. Ensure Python 3.11+ is installed.
2. Install dependencies:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
3. Run backend API:
   ```bash
   uvicorn suryakavach.api:app --host 127.0.0.1 --port 8000 --reload
   ```

### Frontend Setup
1. Install dependencies:
   ```bash
   cd apps/web
   npm install
   ```
2. Launch Vite dev server:
   ```bash
   npm run dev
   ```

---

## 2. PRADAN Data Session Management

Aditya-L1 raw archives are ingested via ISSDC / PRADAN portal.

### Setting Up Session Credentials
Add local session cookies to an ignored `.env` file in the workspace root. Require owner-only permissions (`chmod 600 .env` on Unix/Linux or equivalent Windows ACL restricting access to your user account). Logging or committing `PRADAN_KEYCLOAK_COOKIE` and `PRADAN_SESSION_ID` values is explicitly prohibited.
```env
PRADAN_KEYCLOAK_COOKIE="KEYCLOAK_IDENTITY=...; KEYCLOAK_SESSION=..."
PRADAN_SESSION_ID="your_session_id_here"
```

### Rotating Expired Credentials
1. Log in to the official ISSDC PRADAN portal in a web browser.
2. Open Browser Developer Tools (`F12`) -> Network Tab.
3. Copy the fresh `KEYCLOAK_SESSION` and `KEYCLOAK_IDENTITY` cookies.
4. Update `.env` with the new values.
5. Verify authentication via CLI:
   ```bash
   cd backend && python -m suryakavach.ingest.cli catalogue --payload solexs --limit 5
   ```

---

## 3. Machine Learning & Model Checkpoint Inspection

### Model Checkpoints
- Models are loaded from `data/cache/models/` or configured directory.
- Model card: `model_card.json`
- PyTorch checkpoint: `checkpoint.pt`

### Automatic Baseline Fallback
If PyTorch DLLs fail to load, `checkpoint.pt` is missing, or feature schemas mismatch:
- The system gracefully falls back to `DiscreteHazard` baseline without crashing.
- Evaluation runs log the active provider as `discrete_hazard_baseline` vs `deep_discrete_survival`.

### Triggering Model Evaluation
To evaluate model performance and persist structured metrics:
```bash
cd backend && python -m suryakavach.evaluate --save-db
```

---

## 4. Health & Observability Diagnostics

### Health Check Endpoint
Query the live backend health status:
```bash
curl http://localhost:8000/api/health
```
Response includes:
- `status`: `"ok"` or `"degraded"`
- `data_last_timestamp`: ISO 8601 cursor timestamp
- `source_state`: `"synthetic"`, `"observed_uncalibrated"`, or `"observed_calibrated"`
- `engines`: Engine status mapping

### Metrics & Provenance Endpoint
```bash
curl http://localhost:8000/api/metrics
```

---

## 5. Storage & Cache Management

Raw downloads are stored under `data/raw/pradan/` and indexed in `raw_products`.

### Integrity Verification
Every raw product file has an associated SHA-256 manifest JSON file (`<filename>.manifest.json`).

### Disk Quota & Retention Cleanup
To inspect cached size:
```bash
du -sh data/raw/pradan/
```
To purge raw ZIP archives while preserving extracted FITS/NetCDF files:
```bash
cd backend && python -m suryakavach.ingest.cli prune-raw --keep-days 30
```
