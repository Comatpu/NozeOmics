import json
from pathlib import Path
import tempfile
import tomllib
import unittest
from backend.ai_connection import configure, rewrite

SERVER = {'command': 'C:\\테스트\\NozeOmics.exe', 'args': ['--mcp'], 'env': {'NOZEOMICS_HOME': 'C:\\테스트\\NozeOmics_data'}}


class ConnectionTests(unittest.TestCase):
    def test_preserves_siblings_and_existing_policy(self):
        original = '''# Preserve this comment
model = "example"
description = """
[mcp_servers.nozeomics]
This is text, not a table.
"""
[mcp_servers.other]
command = "other.exe"
[mcp_servers."nozeomics"]
command = "old.exe"
args = []
default_tools_approval_mode = "prompt"
[mcp_servers.nozeomics.env]
CUSTOM = "keep"
[projects."C:/somewhere"]
trust_level = "trusted"
'''
        result = rewrite(original, SERVER)
        parsed = tomllib.loads(result)
        self.assertEqual(parsed['mcp_servers']['other'], {'command': 'other.exe'})
        self.assertEqual(parsed['projects'], tomllib.loads(original)['projects'])
        self.assertEqual(parsed['description'], tomllib.loads(original)['description'])
        self.assertEqual(parsed['mcp_servers']['nozeomics']['env']['CUSTOM'], 'keep')
        self.assertEqual(parsed['mcp_servers']['nozeomics']['default_tools_approval_mode'], 'prompt')
        self.assertIn('# Preserve this comment', result)
        self.assertEqual(rewrite(result, SERVER), result)

    def test_first_launch_repair_backup_and_invalid_configuration(self):
        test_root = Path(__file__).resolve().parents[1] / '.local'
        test_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=test_root) as temp:
            root = Path(temp)
            assert root.resolve().is_relative_to(test_root.resolve())
            config = root / '.codex' / 'config.toml'
            request = {'config_path': str(config), 'home': str(root / '데이터'), 'server': SERVER, 'mode': 'auto'}
            self.assertTrue(configure(request)['changed'])
            saved = config.read_bytes()
            self.assertFalse(configure(request)['changed'])
            self.assertEqual(config.read_bytes(), saved)
            config.write_text('model = "example"\n', encoding='utf-8')
            self.assertFalse(configure(request)['configured'])
            self.assertEqual(config.read_text(), 'model = "example"\n')
            request['mode'] = 'connect'
            self.assertTrue(configure(request)['changed'])
            self.assertTrue(list(config.parent.glob('*.bak')))
            config.write_text('invalid = [', encoding='utf-8')
            with self.assertRaises(tomllib.TOMLDecodeError):
                configure(request)
            self.assertEqual(config.read_text(), 'invalid = [')
            self.assertFalse((config.parent / 'nozeomics-connection.lock').exists())


if __name__ == '__main__':
    unittest.main()
