"""Syntax/import/direct dependency checks only: never starts a service or model."""
import ast
from importlib.metadata import version
from pathlib import Path
import re
import sys

for path in Path('.').glob('*.py'):
    ast.parse(path.read_text(encoding='utf-8-sig'), filename=str(path))
for name in ('requirements.txt', 'requirements-dev.txt'):
    for line in Path(name).read_text().splitlines():
        requirement = re.fullmatch(r'([A-Za-z0-9_-]+)==([^\s]+)', line.strip())
        if requirement:
            assert version(requirement[1]) == requirement[2], f'Direct dependency mismatch: {requirement[1]}'
sys.path.insert(0, str(Path.cwd()))
import main  # noqa: E402; importing is explicitly model-free
from config import Settings  # noqa: E402
Settings.from_env({'NODE_ENV': 'test', 'PRONUNCIATION_ALLOW_INSECURE_LOCAL': 'true'})
assert 'faster_whisper' not in sys.modules, 'Import unexpectedly loaded the model library'
print('Python syntax/import/config/direct dependency checks passed; no model loaded.')
