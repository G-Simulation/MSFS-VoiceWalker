"""pytest-Setup. Macht das Repo-Root als sys.path[0] verfuegbar damit die
Tests `import license_client`, `import updater` etc. direkt machen koennen
ohne Package-Marker."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
