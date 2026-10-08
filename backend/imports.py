from __future__ import annotations

import csv
import gzip
import re
import shutil
import shlex
import tarfile
import zipfile
from collections import Counter
import urllib.parse
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from .common import Problem, file_hash, now, species_name, UNITS


def table(path, recipe=None, preview=None):
    recipe = recipe or {}
    path = Path(path)
    header = recipe.get('header', 0)
    opts = {'dtype': str, 'header': header, 'skiprows': int(recipe.get('skiprows', 0))}
    if preview:
        opts['nrows'] = preview
    if path.suffix.lower() in {'.xlsx', '.xlsm'}:
        frame = pd.read_excel(path, sheet_name=recipe.get('sheet', 0), **opts)
    else:
        sep = recipe.get('separator')
        if not sep:
            op = gzip.open if path.suffix.lower() == '.gz' else open
            with op(path, 'rt', encoding='utf-8-sig') as fh:
                line = fh.readline()
            sep = '\t' if '\t' in line else ',' if ',' in line else r'\s+'
        frame = pd.read_csv(path, sep=sep, comment=recipe.get('comment'), keep_default_na=False, **opts)
    frame.columns = [str(c) for c in frame.columns]
    if recipe.get('row_names'):
        if isinstance(frame.index, pd.RangeIndex):
            raise Problem('row_names_missing', 'The declared row-name column was not found.')
        frame.insert(0, '__feature_id__', frame.index.astype(str))
        frame.reset_index(drop=True, inplace=True)
    return frame


def inspect_file(path):
    path = Path(path).resolve()
    if not path.is_file():
        raise Problem('file_missing', f'File not found: {path}')
    result = {'path': str(path), 'bytes': path.stat().st_size, 'sha256': file_hash(path)}
    if path.suffix.lower() == '.zip' or tarfile.is_tarfile(path):
        if path.suffix.lower() == '.zip':
            with zipfile.ZipFile(path) as archive:
                entries = [{'name': f.filename, 'bytes': f.file_size} for f in archive.infolist()]
        else:
            with tarfile.open(path) as archive:
                entries = [{'name': f.name, 'bytes': f.size} for f in archive.getmembers() if f.isfile()]
        return dict(result, container='archive', total_files=len(entries), files=entries[:200])
    if path.suffix.lower() == '.xlsx':
        result['sheets'] = pd.ExcelFile(path).sheet_names
    frame = table(path, preview=6)
    if path.suffix.lower() in {'.xlsx', '.xlsm'}:
        rows = table(path, {'header': None}, preview=4).values.tolist()
    else:
        op = gzip.open if path.suffix.lower() == '.gz' else open
        with op(path, 'rt', encoding='utf-8-sig') as fh:
            lines = [fh.readline().rstrip('\n') for _ in range(4)]
        rows = [next(csv.reader([line], delimiter='\t' if '\t' in line else ',')) if ('\t' in line or ',' in line) else shlex.split(line) for line in lines if line]
    result.update(columns=list(frame.columns), preview=frame.to_dict(orient='records'), first_rows_without_header=rows, implicit_row_names=not isinstance(frame.index, pd.RangeIndex))
    return result


def extract_results(path, recipe, organism, cache):
    """Import submitted effects without inventing sample-level expression or statistics."""
    frame = table(path, recipe)
    def column(key, required=False):
        value = recipe.get(key)
        if value is None:
            if required:
                raise Problem('column_required', f'Supply {key}.')
            return None
        value = str(frame.columns[value]) if isinstance(value, int) else str(value)
        if value not in frame:
            raise Problem('column_missing', f'Column {value} is not in the table.')
        return value
    gene, effect = column('gene_column', True), column('effect_column', True)
    if recipe.get('effect_scale') != 'log2' or recipe.get('direction') not in {'B_vs_A', 'A_vs_B'}:
        raise Problem('effect_definition_required', 'Confirm effect_scale=log2 and direction=B_vs_A or A_vs_B.')
    kind = recipe.get('data_type')
    if kind not in {'de_result', 'filtered_de'}:
        raise Problem('result_type_required', 'Identify a full DE result table or a filtered DEG table explicitly.')
    ids = frame[gene].fillna('').astype(str).str.strip().tolist()
    if not ids or any(not x for x in ids) or len(set(ids)) != len(ids):
        raise Problem('duplicate_features', 'Result feature IDs must be nonblank and unique; record an adapter if aggregation is needed.')
    def numbers(c):
        if c is None:
            return np.full(len(ids), np.nan)
        original = frame[c].fillna('').astype(str).str.strip()
        missing = original.str.lower().isin({'', 'na', 'nan', 'n/a', 'null', 'none'})
        numeric = pd.to_numeric(original.where(~missing, np.nan), errors='coerce')
        if ((~missing) & (~np.isfinite(numeric))).any():
            raise Problem('non_numeric_results', f'Column {c} contains invalid numeric entries; resolve them in a recorded adapter.')
        return numeric.to_numpy(float)
    fc = numbers(effect)
    if not np.isfinite(fc).any():
        raise Problem('missing_effects', 'No numeric log2 fold changes were found.')
    if recipe['direction'] == 'A_vs_B':
        fc = -fc
    average_col = column('average_column')
    ave = numbers(average_col)
    if average_col:
        scale = recipe.get('average_scale')
        if scale not in {'log2', 'log10', 'linear'}:
            raise Problem('average_scale_required', 'Confirm average_scale=log2, log10 or linear.')
        if scale == 'log10':
            ave *= np.log2(10)
        elif scale == 'linear':
            offset = recipe.get('average_offset')
            if offset is None or float(offset) < 0 or np.any(ave[np.isfinite(ave)] < 0):
                raise Problem('average_offset_required', 'Record a nonnegative offset for log2 transformation of nonnegative average expression.')
            with np.errstate(divide='ignore', invalid='ignore'):
                ave = np.log2(ave+float(offset))
    rawp, adjp = numbers(column('p_column')), numbers(column('adjusted_p_column'))
    for values in (rawp, adjp):
        if np.any((values[np.isfinite(values)] < 0) | (values[np.isfinite(values)] > 1)):
            raise Problem('invalid_p_values', 'P values must be between zero and one, or missing.')
    symcol = column('symbol_column')
    annotation = None
    if symcol:
        symbols = frame[symcol].fillna('').astype(str).tolist()
    elif recipe.get('identifiers') == 'symbol':
        symbols = ids.copy()
    elif recipe.get('annotate', True):
        symbols, annotation = annotate(ids, organism, cache)
    else:
        symbols = ['']*len(ids)
    return ids, symbols, pd.DataFrame({'feature_id': ids, 'logFC': fc, 'AveExpr': ave,
                                      'P.Value': rawp, 'adj.P.Val': adjp}), annotation


def download(url, destination, cancel=None):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in {'www.ncbi.nlm.nih.gov', 'ftp.ncbi.nlm.nih.gov', 'www.ebi.ac.uk', 'ftp.ebi.ac.uk'}:
        raise Problem('unsupported_download', 'Use an HTTPS NCBI/EBI source, or download the source externally and supply its local path.')
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_suffix(destination.suffix + '.partial')
    with requests.get(url, timeout=(20, 120), stream=True, allow_redirects=False) as response:
        response.raise_for_status()
        if response.is_redirect:
            raise Problem('download_redirect', 'Use the final public source URL explicitly.')
        with open(tmp, 'wb') as fh:
            for block in response.iter_content(1024 * 1024):
                if cancel and cancel.is_set():
                    raise Problem('retrieval_cancelled', 'Source retrieval was stopped.')
                fh.write(block)
    tmp.replace(destination)
    return {'path': str(destination.resolve()), 'url': url, 'sha256': file_hash(destination), 'retrieved_at': now()}


def geo_metadata(gse):
    if not re.fullmatch(r'GSE\d+', gse):
        raise Problem('invalid_accession', 'Supply a GSE accession such as GSE255988.')
    response = requests.get('https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi', params={'acc': gse, 'targ': 'all', 'view': 'full', 'form': 'text'}, timeout=(20, 90))
    response.raise_for_status()
    text = response.content.decode('utf-8',errors='replace')
    series, samples, current = {}, [], None
    for line in text.splitlines():
        if line.startswith('^SAMPLE = '):
            current = {'gsm': line.split(' = ', 1)[1], 'fields': {}}
            samples.append(current)
        elif line.startswith('!Sample_') and current:
            key, value = line.split(' = ', 1) if ' = ' in line else (line, '')
            current['fields'].setdefault(key[1:], []).append(value)
        elif line.startswith('!Series_') and ' = ' in line:
            key, value = line.split(' = ', 1)
            series.setdefault(key[1:], []).append(value)
    if not samples:
        raise Problem('geo_metadata_unavailable', 'GEO returned no GSM metadata. Inspect its family SOFT file or GEO pages explicitly.')
    for sample in samples:
        aliases = [sample['gsm']]
        fields = sample['fields']
        for key in ('Sample_title', 'Sample_source_name_ch1', 'Sample_description', 'Sample_characteristics_ch1'):
            for value in fields.get(key, []):
                aliases.append(value)
                if ':' in value:
                    aliases.append(value.split(':', 1)[1].strip())
        sample['aliases'] = list(dict.fromkeys(aliases))
    return {'gse': gse, 'series': series, 'samples': samples, 'source_url': response.url, 'raw_text': text, 'retrieved_at': now()}


def annotate(ids, species, cache):
    species = species_name(species)
    name = 'Homo_sapiens' if species == 'Homo sapiens' else 'Mus_musculus'
    path = Path(cache) / (name + '.gene_info.gz')
    url = f'https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Mammalia/{name}.gene_info.gz'
    if not path.exists():
        download(url, path)
    mapping, conflicts = {}, set()
    with gzip.open(path, 'rt', encoding='utf-8') as fh:
        for line in fh:
            if line.startswith('#'):
                continue
            cols = line.rstrip('\n').split('\t')
            if len(cols) < 6:
                continue
            keys = [cols[1], cols[2]] + [v[8:] for v in cols[5].split('|') if v.startswith('Ensembl:')]
            for key in keys:
                if key in mapping and mapping[key] != cols[2]:
                    conflicts.add(key)
                mapping[key] = cols[2]
    symbols = [mapping.get(re.sub(r'\.\d+$', '', str(gid)), '') if re.sub(r'\.\d+$', '', str(gid)) not in conflicts else '' for gid in ids]
    return symbols, {'source': url, 'sha256': file_hash(path), 'lookup_at': now(), 'ambiguous_identifiers': sum(re.sub(r'\.\d+$', '', str(g)) in conflicts for g in ids)}


def extract(path, recipe, samples, organism, cache):
    species = species_name(organism)
    unit = recipe.get('unit')
    if unit not in UNITS:
        raise Problem('unit_required', 'Specify raw_count, estimated_count, CPM, TPM, FPKM, RPKM or confirmed log2 expression.')
    frame = table(path, recipe)
    columns = list(frame.columns)
    def col(value):
        if isinstance(value, int):
            if not 0 <= value < len(columns):
                raise Problem('column_missing', f'Column index {value} is outside the table.')
            return columns[value]
        if str(value) not in columns:
            raise Problem('column_missing', f'Column {value} is not in the table.')
        return str(value)
    gene_col = col(recipe.get('gene_column', 0))
    if recipe.get('orientation', 'genes_by_samples') != 'genes_by_samples':
        raise Problem('adapter_required', 'Transpose this input in a recorded adapter and supply a genes-by-samples matrix.')
    if not samples:
        raise Problem('samples_required', 'Supply the verified sample-to-column mapping.')
    if any(not isinstance(s.get('id') or s.get('gsm'),str) or not (s.get('id') or s.get('gsm')).strip() for s in samples):
        raise Problem('sample_id_required','Supply a nonblank stable ID or GSM accession for every sample.')
    if len({s.get('gsm') or s.get('id') for s in samples}) != len(samples):
        raise Problem('duplicate_samples', 'Sample identities must be unique. Merge verified technical replicates before import.')
    selected = [col(s['source_column']) for s in samples]
    if len(set(selected)) != len(selected) or gene_col in selected:
        raise Problem('duplicate_columns', 'Each sample must map to a different expression column, not the gene identifier column.')
    ids = [str(v).strip() if pd.notna(v) else '' for v in frame[gene_col]]
    if any(not g for g in ids) or len(set(ids)) != len(ids):
        raise Problem('duplicate_features', 'Feature identifiers are blank or duplicated. Record an explicit aggregation rule in an adapter.')
    matrix = frame[selected].apply(pd.to_numeric, errors='coerce').to_numpy(dtype=float)
    if not np.isfinite(matrix).all():
        bad = np.argwhere(~np.isfinite(matrix))[:12]
        raise Problem('non_numeric_expression', 'Selected expression columns contain missing or nonnumeric values; do not fill them with zero.', [{'feature': ids[i], 'column': selected[j]} for i, j in bad])
    if unit != 'log2' and (matrix < 0).any():
        raise Problem('negative_expression', 'Non-log expression values cannot be negative.')
    if unit == 'raw_count' and not np.allclose(matrix, np.round(matrix), rtol=0, atol=1e-8):
        raise Problem('noninteger_counts', 'This matrix is not integer raw counts. Verify its actual unit.')
    if unit in {'raw_count', 'estimated_count'} and (matrix.sum(axis=0) <= 0).any():
        raise Problem('empty_library', 'A selected count sample has zero library size.')
    annotation = None
    if recipe.get('symbol_column') is not None:
        symbols = frame[col(recipe['symbol_column'])].fillna('').astype(str).tolist()
    elif recipe.get('identifiers') == 'symbol':
        symbols = ids.copy()
    elif recipe.get('annotate', True):
        symbols, annotation = annotate(ids, species, cache)
    else:
        symbols = [''] * len(ids)
    records = []
    for index, sample in enumerate(samples):
        evidence = sample.get('evidence')
        if not evidence or not isinstance(evidence, list) or any(not e.get('source') or not e.get('locator') or not e.get('value') for e in evidence):
            raise Problem('mapping_evidence_required', f'Provide source, locator and value evidence for {sample.get("gsm") or selected[index]}.')
        records.append(dict(sample, id=sample.get('id') or sample.get('gsm'), source_column=selected[index], organism=species))
    return matrix, ids, symbols, records, annotation


def legacy(path):
    workbook = pd.ExcelFile(path)
    if not {'Standardized', 'Report', 'Sample_metadata'}.issubset(workbook.sheet_names):
        raise Problem('legacy_schema', 'This workbook must contain Standardized, Report and Sample_metadata sheets.')
    report = pd.read_excel(workbook, sheet_name='Report', dtype=object)
    r = {str(k).strip().lower().replace(' ', '_'): str(v) for k, v in zip(report['field'], report['value']) if not pd.isna(k)}
    frame = pd.read_excel(workbook, sheet_name='Standardized', dtype=object)
    metadata = pd.read_excel(workbook, sheet_name='Sample_metadata', dtype=object).fillna('')
    columns = {str(c).lower().replace('_', ' '): c for c in metadata.columns}
    def pick(*choices):
        for c in choices:
            if c in columns:
                return columns[c]
        raise Problem('legacy_metadata', f'Sample metadata lacks {choices}.')
    scol = pick('matrix column', 'column')
    gcol = pick('group')
    gsmcol = pick('gsm accession', 'gsm')
    ncol = pick('sample name', 'name')
    samples = [{'id': str(row[gsmcol]) or str(row[scol]), 'gsm': str(row[gsmcol]), 'name': str(row[ncol]), 'source_column': str(row[scol]), 'group': str(row[gcol]), 'evidence': [{'source': str(path), 'locator': f'Sample_metadata row {i+2}', 'value': str(row[scol]), 'status': 'legacy'}]} for i, (_, row) in enumerate(metadata.iterrows())]
    matrix = frame[[s['source_column'] for s in samples]].apply(pd.to_numeric, errors='coerce').to_numpy(float)
    if not np.isfinite(matrix).all():
        raise Problem('legacy_expression', 'This workbook has incomplete expression values. Prepare a validated matrix explicitly.')
    effect_col = next((c for c in ['logFC', 'lfc', 'log2FoldChange'] if c in frame), None)
    p_col = next((c for c in ['P.Value', 'P.value', 'PValue'] if c in frame), None)
    ids = [str(v) if pd.notna(v) and str(v).strip() else f'legacy-row-{i+2}' for i,v in enumerate(frame['code'])]
    symbols = [str(v) if pd.notna(v) else '' for v in frame['name']]
    repeated={gid for gid,count in Counter(ids).items() if count>1}
    if repeated:
        r['duplicate_feature_ids']=len(repeated)
        r['legacy_row_identity_note']='Repeated submitted codes are retained as distinct original workbook rows; no gene aggregation was performed.'
        ids=[f'{gid} [legacy row {i+2}]' if gid in repeated else gid for i,gid in enumerate(ids)]
    r['missing_feature_ids'] = sum(v.startswith('legacy-row-') for v in ids)
    result = pd.DataFrame({'feature_id': ids, 'AveExpr': pd.to_numeric(frame['AveExpr'], errors='coerce'), 'logFC': pd.to_numeric(frame[effect_col], errors='coerce') if effect_col else np.nan, 'P.Value': pd.to_numeric(frame[p_col], errors='coerce') if p_col else np.nan, 'adj.P.Val': pd.to_numeric(frame['adj.P.Val'], errors='coerce')})
    input_type = r.get('input_data', '')
    output_type = r.get('output_data_type', r.get('output_data', ''))
    unit = 'log2' if 'Log-normalized' in input_type else 'CPM' if 'CPM' in output_type or 'count' in input_type.lower() else next((u for u in ['TPM', 'FPKM', 'RPKM'] if u in output_type or u in input_type), 'CPM')
    answer = {'matrix': matrix, 'ids': ids, 'symbols': symbols, 'samples': samples, 'unit': unit, 'organism': species_name(r.get('organism', '')), 'gse': r.get('gse_accession', r.get('gse', 'Imported')), 'report': r, 'results': result}
    workbook.close()
    return answer
