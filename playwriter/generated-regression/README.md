# Playwriter Exported Regression Test

## Setup

```bash
python -m venv .venv
# macOS/Linux
source .venv/bin/activate
# Windows PowerShell
# .venv\Scripts\Activate.ps1
pip install -r requirements.txt
playwright install chromium
```

## Run

```bash
pytest -q
```
