from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import numpy as np
import pandas as pd

from .common import Problem, atomic_json, clean, digest, now


def rscript(root):
    paths = [Path(os.environ['NOZEOMICS_RSCRIPT'])] if os.environ.get('NOZEOMICS_RSCRIPT') else []
    paths += [Path(root) / 'runtime/R/bin/Rscript.exe', Path(root) / 'runtime/R/bin/x64/Rscript.exe']
    for path in paths:
        if path.is_file():
            return path
    raise Problem('runtime_unavailable', 'The bundled R runtime is missing. Reinstall the complete NozeOmics package.')


def run_r(root, work, matrix, feature_ids, samples, unit, blocking=None, transform=False, cancel=None, on_process=None):
    root, work = Path(root).resolve(), Path(work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root/'backend/analysis.R', work/'analysis.R')
    pd.DataFrame(matrix, index=feature_ids, columns=[s['id'] for s in samples]).to_csv(work/'matrix.tsv', sep='\t', index_label='feature_id')
    pd.DataFrame(samples).drop(columns=['evidence'], errors='ignore').fillna('').to_csv(work/'samples.tsv', sep='\t', index=False)
    blocking = blocking or []
    if any(not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', c) or c in {'condition', 'group', 'id'} for c in blocking):
        raise Problem('invalid_design', 'Blocking fields must be simple metadata names such as subject or batch.')
    env = os.environ.copy()
    env['R_LIBS_USER'] = str(Path(root)/'runtime/R/library')
    env['LC_ALL'] = 'C'
    flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    with open(work/'stdout.log', 'w', encoding='utf-8') as out, open(work/'stderr.log', 'w', encoding='utf-8') as err:
        # Windows R corrupts non-ASCII paths in commandArgs under the C locale.
        # Let the OS set the Unicode working directory and pass only relative paths.
        process = subprocess.Popen([str(rscript(root)), '--vanilla', 'analysis.R', '.', 'transform' if transform else 'analysis', unit, ','.join(blocking)], cwd=work, stdout=out, stderr=err, env=env, **flags)
        if on_process:
            on_process(process)
        while process.poll() is None:
            if cancel and cancel.wait(0.1):
                process.terminate()
                process.wait(timeout=15)
                raise Problem('job_cancelled', 'Analysis cancelled.')
            if not cancel:
                try:
                    process.wait(timeout=0.2)
                except subprocess.TimeoutExpired:
                    pass
    if process.returncode:
        error = (work/'stderr.log').read_text(encoding='utf-8', errors='replace')[-5000:]
        raise Problem('analysis_failed', error.strip() or 'R analysis failed; inspect the saved run log.')
    expression = pd.read_csv(work/'expression.tsv', sep='\t', index_col=0).to_numpy(float)
    result = pd.read_csv(work/'results.tsv', sep='\t', dtype={'feature_id': str}) if not transform else None
    return expression, result, (work/'environment.txt').read_text(encoding='utf-8')


def pca(matrix, samples, unit, n_top=500):
    if matrix.shape[1] < 3:
        raise Problem('pca_samples', 'PCA needs at least three included samples and two nonzero components.')
    eligible = np.isfinite(matrix).all(axis=1) & (np.var(matrix, axis=1) > 1e-12)
    if unit != 'log2':
        raise Problem('pca_transform', 'Use a recorded log-expression layer for PCA.')
    ids = np.flatnonzero(eligible)
    if len(ids) < 2:
        raise Problem('pca_features', 'PCA has fewer than two variable complete features.')
    order = ids[np.argsort(-np.var(matrix[ids], axis=1), kind='stable')]
    chosen = order[:min(len(order), int(n_top))] if n_top else order
    centered = matrix[chosen].T - matrix[chosen].mean(axis=1)
    u, s, vt = np.linalg.svd(centered, full_matrices=False)
    if len(s) < 2 or s[1] <= max(1e-10, s[0]*1e-10):
        raise Problem('pca_rank', 'The expression matrix has fewer than two nonzero principal components.')
    coords = u[:, :2] * s[:2]
    for i in range(2):
        if vt[i, np.argmax(np.abs(vt[i]))] < 0:
            coords[:, i] *= -1
    fraction = s[:2]**2 / np.sum(s**2)
    return {'points': [dict(sample_id=sam['id'], x=coords[i,0], y=coords[i,1]) for i, sam in enumerate(samples)], 'variance': fraction.tolist(), 'n_features': len(chosen), 'feature_indices': chosen.tolist(), 'centering': True, 'scaling': False}
