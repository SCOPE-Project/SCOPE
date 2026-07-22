import sys
from pathlib import Path

# Safety guard: Ensure the script is run using the virtual environment (venv)
if sys.prefix == sys.base_prefix:
    venv_python = Path(__file__).resolve().parent / ".venv" / "Scripts" / "python.exe"
    print("\n[ERROR] You are running this script with the global Python interpreter:", file=sys.stderr)
    print(f"        {sys.executable}\n", file=sys.stderr)
    print("Please activate your virtual environment first, or run directly using the venv's Python:", file=sys.stderr)
    if venv_python.exists():
         print(f"        .\\.venv\\Scripts\\python.exe run.py\n", file=sys.stderr)
    else:
         print("        .\\.venv\\Scripts\\python.exe run.py\n", file=sys.stderr)
    sys.exit(1)

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)