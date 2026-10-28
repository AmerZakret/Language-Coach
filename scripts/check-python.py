"""Offline syntax, complete lock and installed dependency checks; no model load."""
import ast
import hashlib
from importlib.metadata import distributions, version
from pathlib import Path
import re
import sys

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
import yaml


def validate_workflow(text):
    # BaseLoader keeps GitHub's YAML `on` key as text, not YAML 1.1 boolean true.
    workflow = yaml.load(text, Loader=yaml.BaseLoader)
    assert workflow['permissions'] == {'contents': 'read'}, 'Workflow permissions must stay read-only'
    assert {'push', 'pull_request', 'workflow_dispatch'} <= set(workflow['on']), 'Workflow triggers drift'
    assert set(workflow['jobs']) == {'backend', 'web', 'flutter', 'pronunciation', 'release-hygiene'}, 'Required jobs drift'
    for job in workflow['jobs'].values():
        assert all(value in ('read', 'none') for value in job.get('permissions', {}).values()), 'Job write permissions forbidden'
        assert job.get('runs-on') == 'ubuntu-24.04' and job.get('steps'), 'Invalid validation job'
    uses = re.findall(r'^\s*-?\s*uses:\s*(\S+)(.*)$', text, re.MULTILINE)
    assert uses, 'Missing actions'
    for action, comment in uses:
        if action.startswith('./'):
            continue  # Local repository actions are pinned by this checkout.
        assert re.fullmatch(r'[\w.-]+/[\w./-]+@[a-f0-9]{40}', action), 'Remote action requires immutable SHA'
        assert re.fullmatch(r'\s+# v\d+\.\d+\.\d+\s*', comment), 'Action requires semantic release comment'
    return len({action for action, _ in uses})


def read_lock(path):
    text = path.read_text(encoding='utf-8')
    assert '--require-hashes' in text and '--only-binary=:all:' in text, 'Lock must require wheel hashes'
    result = {}
    for line in text.replace('\\\n', '').splitlines():
        if not line.strip() or line.startswith(('#', '--')):
            continue
        parts = line.split('--hash=sha256:')
        requirement = Requirement(parts[0].strip())
        specs = list(requirement.specifier)
        assert len(specs) == 1 and specs[0].operator == '==' and '*' not in specs[0].version, 'Exact pin required'
        assert len(parts) > 1 and all(re.fullmatch(r'[a-f0-9]{64}', item.strip()) for item in parts[1:]), 'Wheel hash required'
        name = canonicalize_name(requirement.name)
        assert name not in result, 'Duplicate pin'
        result[name] = requirement
    return result


def main():
    root = Path(__file__).resolve().parent.parent
    for path in (root / '.github/workflows').iterdir():
        if path.suffix in ('.yml', '.yaml'):
            count = validate_workflow(path.read_text(encoding='utf-8'))
            print(f'Workflow YAML, {count} action SHA pins and read-only permissions verified: {path.name}')
    for path in Path('.').glob('*.py'):
        ast.parse(path.read_text(encoding='utf-8-sig'), filename=str(path))
    source = Path('requirements.in').read_text(encoding='utf-8')
    digest = hashlib.sha256(source.encode('utf-8')).hexdigest()
    assert f'# requirements.in sha256: {digest}' in Path('requirements.txt').read_text(), 'Regenerate changed lock input'
    lock = read_lock(Path('requirements.txt'))
    inputs = {canonicalize_name(req.name): req for line in source.splitlines()
              if line.strip() and not line.startswith('#') for req in [Requirement(line)]}
    assert {name: str(req) for name, req in lock.items()} == {name: str(req) for name, req in inputs.items()}, 'Lock/input drift'
    lock.update(read_lock(Path('requirements-installer.txt')))
    active = {name: req for name, req in lock.items() if req.marker is None or req.marker.evaluate()}
    installed = {canonicalize_name(dist.metadata['Name']): dist for dist in distributions()}
    assert set(installed) == set(active), f'Unpinned or missing packages: {sorted(set(installed) ^ set(active))}'
    for name, req in active.items():
        assert req.specifier.contains(version(name)), f'Locked dependency mismatch: {name}'
        for dependency in installed[name].requires or []:
            dep = Requirement(dependency)
            if dep.marker is None or dep.marker.evaluate({'extra': ''}):
                target = canonicalize_name(dep.name)
                assert target in active and dep.specifier.contains(version(target)), f'Unresolved dependency: {name} -> {target}'
    assert Path('requirements-dev.txt').read_text().splitlines()[0] == '-r requirements.txt', 'Dev lock drift'
    sys.path.insert(0, str(Path.cwd()))
    import main as service
    from config import Settings
    Settings.from_env({'NODE_ENV': 'test', 'PRONUNCIATION_ALLOW_INSECURE_LOCAL': 'true'})
    assert service.app is not None and 'faster_whisper' not in sys.modules, 'Import unexpectedly loaded the model library'
    print(f'Python syntax/import/config and all {len(active)} locked packages verified; no model loaded.')


if __name__ == '__main__':
    main()
