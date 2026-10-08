"""Register the local MCP server without rewriting unrelated Codex settings."""
from __future__ import annotations
import copy
import datetime
import json
import os
from pathlib import Path
import re
import sys
import time
import tomllib
import uuid


def scalar(value):
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, list):
        return '[' + ', '.join(scalar(v) for v in value) + ']'
    if isinstance(value, dict):
        return '{ ' + ', '.join(scalar(k) + ' = ' + scalar(v) for k, v in value.items()) + ' }'
    raise ValueError('Unsupported connection setting.')


def render_server(server):
    lines = []
    def table(keys, values):
        lines.append('[' + '.'.join(scalar(k) for k in keys) + ']')
        lines.extend(scalar(k) + ' = ' + scalar(v) for k, v in values.items() if not isinstance(v, dict))
        lines.append('')
        for key, value in values.items():
            if isinstance(value, dict):
                table(keys + [key], value)
    table(['mcp_servers', 'nozeomics'], server)
    return '\n'.join(lines) + '\n'


def rewrite(text, desired):
    old = tomllib.loads(text)
    previous = old.get('mcp_servers', {}).get('nozeomics', {})
    server = copy.deepcopy(previous)
    # A former HTTP entry cannot coexist with this local stdio transport.
    for key in ('url', 'bearer_token_env_var', 'http_headers', 'env_http_headers', 'oauth'):
        server.pop(key, None)
    server.update({k: v for k, v in desired.items() if k != 'env'})
    server['enabled'] = True
    server['env'] = {**previous.get('env', {}), **desired.get('env', {})}
    expected = copy.deepcopy(old)
    expected.setdefault('mcp_servers', {})['nozeomics'] = server
    if expected == old:
        return text
    headers = []
    for match in re.finditer(r'^\s*\[.+?\][^\r\n]*', text, re.M):
        try:
            # A header-like line inside a multiline string is not a table.
            tomllib.loads(text[:match.start()])
            parsed = tomllib.loads(match.group().strip() + '\n__noze_header__ = true\n')
            keys = []
            while isinstance(parsed, dict) and len(parsed) == 1:
                key, parsed = next(iter(parsed.items()))
                if key == '__noze_header__':
                    break
                keys.append(key)
            headers.append((match.start(), keys))
        except tomllib.TOMLDecodeError:
            continue
    chunks, cursor = [], 0
    for index, (start, keys) in enumerate(headers):
        if keys[:2] != ['mcp_servers', 'nozeomics']:
            continue
        end = headers[index + 1][0] if index + 1 < len(headers) else len(text)
        chunks.append(text[cursor:start])
        cursor = end
    chunks.append(text[cursor:])
    candidate = ''.join(chunks).rstrip() + '\n\n' + render_server(server)
    if tomllib.loads(candidate) != expected:
        raise ValueError('This Codex configuration needs manual connection setup. It was left unchanged.')
    return candidate


def atomic_write(file, contents):
    temp = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_bytes(contents)
        os.replace(temp, file)
    finally:
        temp.unlink(missing_ok=True)


def configure(request):
    config = Path(request['config_path'])
    marker = Path(request['home']) / 'ai-connection.json'
    desired = request['server']
    signature = {'config_path': str(config), 'server': desired}
    config.parent.mkdir(parents=True, exist_ok=True)
    lock = config.with_name('nozeomics-connection.lock')
    for attempt in range(40):
        try:
            descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            time.sleep(.05)
    else:
        raise ValueError('Connection setup is busy. Please try again.')
    try:
        os.close(descriptor)
        original = config.read_bytes() if config.exists() else b''
        text = original.decode('utf-8-sig')
        parsed = tomllib.loads(text)
        entry = parsed.get('mcp_servers', {}).get('nozeomics', {})
        registered = all(entry.get(k) == v for k, v in desired.items() if k != 'env') and all(entry.get('env', {}).get(k) == v for k, v in desired.get('env', {}).items()) and entry.get('enabled', True)
        if request.get('mode') == 'status':
            return {'configured': bool(registered), 'changed': False}
        try:
            already_attempted = json.loads(marker.read_text('utf-8')) == signature
        except (OSError, ValueError):
            already_attempted = False
        if request.get('mode') == 'auto' and already_attempted:
            return {'configured': bool(registered), 'changed': False}
        candidate = rewrite(text, desired)
        changed = candidate != text
        if changed:
            if (config.read_bytes() if config.exists() else b'') != original:
                raise ValueError('Codex settings changed during setup. Please try again.')
            if original:
                backup = config.with_name('config.toml.nozeomics-' + uuid.uuid4().hex[:12] + '.bak')
                backup.write_bytes(original)
            atomic_write(config, candidate.encode('utf-8'))
        marker.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(marker, json.dumps(signature, ensure_ascii=False).encode('utf-8'))
        return {'configured': True, 'changed': changed}
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        print(json.dumps(configure(json.load(sys.stdin))))
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) and not isinstance(error, tomllib.TOMLDecodeError) else 'Could not update Codex settings. Your existing configuration was left unchanged.'
        print(json.dumps({'configured': False, 'error': message}))
        sys.exit(1)
