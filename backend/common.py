from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

VERSION = json.loads((Path(__file__).resolve().parents[1]/'release.json').read_text(encoding='utf-8'))['version']
DEFAULT_HUMAN = ['ACTB', 'GAPDH', 'RPLP0', 'PPIA', 'B2M', 'MKI67', 'PTPRC', 'EPCAM', 'PECAM1', 'COL1A1', 'CD68', 'VIM', 'IL6', 'TNF']
UNITS = {'raw_count', 'estimated_count', 'CPM', 'TPM', 'FPKM', 'RPKM', 'log2'}


class Problem(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details

    def record(self):
        return {'code': self.code, 'message': self.message, 'details': self.details}


def now():
    return datetime.now(timezone.utc).isoformat()


def clean(value):
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [clean(v) for v in value]
    if isinstance(value, np.generic):
        return clean(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, Path):
        return str(value)
    return value


def encoded(value):
    return json.dumps(clean(value), ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name, suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as fh:
            fh.write(encoded(value))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def read_json(path, default=None):
    return json.loads(Path(path).read_text(encoding='utf-8')) if Path(path).exists() else default


def default_panel(species):
    return DEFAULT_HUMAN.copy() if species == 'Homo sapiens' else [s.capitalize() for s in DEFAULT_HUMAN]


def species_name(value):
    v = str(value).lower().strip()
    names = {'human': 'Homo sapiens', 'homo sapiens': 'Homo sapiens', '9606': 'Homo sapiens', 'mouse': 'Mus musculus', 'mus musculus': 'Mus musculus', '10090': 'Mus musculus'}
    if v not in names:
        raise Problem('unsupported_species', 'This version supports human and mouse gene-level bulk RNA-seq.')
    return names[v]
