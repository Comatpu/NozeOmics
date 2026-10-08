"""Preserve and consolidate workspaces split by Windows AppData virtualization."""
from __future__ import annotations

import copy
import json
import os
import shutil
from pathlib import Path

from .common import atomic_json, file_hash, now


def legacy_homes():
    profile = Path(os.environ.get('USERPROFILE', str(Path.home())))
    roaming = profile / 'AppData' / 'Roaming' / 'NozeOmics'
    roots = [roaming]
    packages = profile / 'AppData' / 'Local' / 'Packages'
    if packages.exists():
        roots.extend(p / 'LocalCache' / 'Roaming' / 'NozeOmics'
                     for p in sorted(packages.glob('OpenAI.Codex_*')))
    return roots


def rebase(value, old_roots, home):
    if isinstance(value, dict):
        return {k: rebase(v, old_roots, home) for k, v in value.items()}
    if isinstance(value, list):
        return [rebase(v, old_roots, home) for v in value]
    if isinstance(value, str):
        normal = value.replace('/', '\\')
        for root in old_roots:
            prefix = str(root).rstrip('\\/').replace('/', '\\')
            if normal.lower().startswith(prefix.lower() + '\\'):
                return str(home / Path(normal[len(prefix) + 1:]))
    return value


def migrate_legacy(home, sources=None):
    home = Path(home).resolve()
    default = Path(os.environ.get('USERPROFILE', str(Path.home()))) / 'NozeOmics'
    if sources is None and home != default.resolve():
        return None  # Explicit isolated workspaces remain isolated.
    marker = home / 'storage-migration.json'
    if marker.exists():
        return json.loads(marker.read_text(encoding='utf-8'))
    sources = [Path(p) for p in (sources if sources is not None else legacy_homes())]
    home.mkdir(parents=True, exist_ok=True)
    target = home / 'workspace.json'
    existing = json.loads(target.read_text(encoding='utf-8')) if target.exists() else None
    state = copy.deepcopy(existing)
    report = {'completed': now(), 'home': str(home), 'sources': [], 'imported_projects': [], 'conflicts': []}
    backup = home / 'migration-backups'
    for index, source in enumerate(sources):
        src = source / 'workspace.json'
        if not src.is_file() or source.resolve() == home:
            continue
        original = json.loads(src.read_text(encoding='utf-8'))
        if original.get('schema') != 1 or not isinstance(original.get('projects'), dict):
            raise ValueError(f'Unrecognized legacy workspace: {src}')
        backup.mkdir(exist_ok=True)
        shutil.copy2(src, backup / f'legacy-{index}-workspace.json')
        report['sources'].append({'home': str(source), 'sha256': file_hash(src)})
        moved = rebase(original, [source, sources[0], legacy_homes()[0]], home)
        if state is None:
            state = copy.deepcopy(moved)
            state['projects'] = {}
        for pid, project in moved['projects'].items():
            # Workspace IDs also become directory names: reject path traversal.
            if not pid or '/' in pid or '\\' in pid or pid in {'.', '..'}:
                raise ValueError('Invalid legacy project ID.')
            if pid in state['projects']:
                if state['projects'][pid] != project:
                    report['conflicts'].append({'project_id': pid, 'preserved_at': str(source)})
                continue
            folder = source / 'projects' / pid
            if not folder.is_dir():
                raise ValueError(f'Legacy project files are missing: {folder}')
            shutil.copytree(folder, home / 'projects' / pid, dirs_exist_ok=True)
            state['projects'][pid] = project
            report['imported_projects'].append(pid)
        state['jobs'].update(moved.get('jobs', {}))
        state['revision'] = max(state['revision'], moved['revision'])
        if not state.get('active_project') and moved.get('active_project') in state['projects']:
            state['active_project'] = moved['active_project']
    if state is not None:
        if existing is not None:
            backup.mkdir(exist_ok=True)
            shutil.copy2(target, backup / 'shared-workspace-before-migration.json')
        state['revision'] += 1
        state['operations'] = {}  # Responses from the previous storage path are stale.
        atomic_json(target, state)
    atomic_json(marker, report)
    return report
