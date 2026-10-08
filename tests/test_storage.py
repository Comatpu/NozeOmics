import json
import tempfile
import unittest
from pathlib import Path

from backend.migration import migrate_legacy


def create(home, project_id=None, revision=0):
    home.mkdir(parents=True, exist_ok=True)
    state = {'schema': 1, 'revision': revision, 'active_project': project_id,
             'projects': {}, 'jobs': {}, 'receipts': [], 'operations': {}}
    if project_id:
        folder = home / 'projects' / project_id
        folder.mkdir(parents=True)
        (folder / 'assay.txt').write_text('original values', encoding='utf-8')
        state['projects'][project_id] = {'id': project_id, 'name': home.name,
                                       'source_path': str(folder / 'assay.txt')}
    (home / 'workspace.json').write_text(json.dumps(state), encoding='utf-8')
    return state


class StorageTests(unittest.TestCase):
    def test_split_workspaces_are_preserved_and_rebased(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            real, virtual, shared = [root / name for name in ('real', 'virtual', 'shared')]
            create(real)
            create(virtual, 'example-project', 12)
            original = (virtual / 'workspace.json').read_bytes()
            result = migrate_legacy(shared, [real, virtual])
            state = json.loads((shared / 'workspace.json').read_text())
            self.assertEqual(state['active_project'], 'example-project')
            self.assertEqual(state['revision'], 13)
            migrated = Path(state['projects']['example-project']['source_path'])
            self.assertEqual(migrated, shared / 'projects' / 'example-project' / 'assay.txt')
            self.assertEqual(migrated.read_text(), 'original values')
            self.assertEqual((virtual / 'workspace.json').read_bytes(), original)
            self.assertEqual(migrate_legacy(shared, [real, virtual]), result)

    def test_existing_shared_project_wins_and_legacy_remains(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            legacy, shared = root / 'legacy', root / 'shared'
            create(legacy, 'same-project')
            create(shared, 'same-project', 9)
            result = migrate_legacy(shared, [legacy])
            state = json.loads((shared / 'workspace.json').read_text())
            self.assertEqual(state['projects']['same-project']['name'], 'shared')
            self.assertEqual(len(result['conflicts']), 1)
            self.assertTrue((legacy / 'projects' / 'same-project' / 'assay.txt').exists())

    def test_missing_project_files_do_not_commit_a_migration(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            legacy, shared = root / 'legacy', root / 'shared'
            state = create(legacy)
            state['projects']['missing-project'] = {'id': 'missing-project'}
            (legacy / 'workspace.json').write_text(json.dumps(state))
            with self.assertRaises(ValueError):
                migrate_legacy(shared, [legacy])
            self.assertFalse((shared / 'storage-migration.json').exists())
            self.assertFalse((shared / 'workspace.json').exists())


if __name__ == '__main__':
    unittest.main()
