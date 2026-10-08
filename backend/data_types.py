"""Assay meaning is separate from a file's container and supported operations."""
TYPES = {
    'raw_count': 'Raw count matrix', 'estimated_count': 'Estimated count matrix',
    'CPM': 'CPM matrix', 'TPM': 'TPM matrix', 'FPKM': 'FPKM matrix',
    'RPKM': 'RPKM matrix', 'log2': 'Log-normalized expression matrix',
    'de_result': 'DE result table', 'filtered_de': 'Filtered DEG table',
    'raw_sequence': 'FASTQ / BAM', 'unknown': 'Unknown',
}


def classification(kind, *, has_average=True):
    matrix = kind in {'raw_count', 'estimated_count', 'CPM', 'TPM', 'FPKM', 'RPKM', 'log2'}
    result = kind in {'de_result', 'filtered_de'}
    caps = dict(trend=matrix or result, ma=matrix or (result and has_average),
                heatmap=matrix, pca=matrix, recalculate=matrix)
    reasons = {}
    if result:
        reasons.update(heatmap='Sample expression values were not provided.',
                       pca='Sample expression values were not provided.',
                       recalculate='Submitted statistics cannot be recalculated without sample expression values.')
        if not has_average:
            reasons['ma'] = 'Average expression was not provided on a confirmed scale.'
    if not matrix and not result:
        reasons = {key: 'A verified expression matrix or DE result table is required.' for key in caps}
    return {'data_type': kind, 'data_type_label': TYPES.get(kind, TYPES['unknown']),
            'capabilities': caps, 'unsupported_reasons': reasons,
            'partial_results': kind == 'filtered_de'}
