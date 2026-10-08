---
name: nozeomics-analysis
description: Prepare GEO bulk RNA-seq studies, configure supported comparisons, and explore results in the local NozeOmics desktop program through its MCP tools.
---

# NozeOmics analysis

Work through the connected NozeOmics tools. UI and AI share one autosaved project. Read `nozeomics_get_state` first; use its revision for mutations. On a revision conflict read again and reconcile the user's latest changes. Reuse request IDs for retries of the same view/analysis request.

For a disease request, collect relevant GSEs without an arbitrary 3–5 study cap. Agree on organism, tissue/cohort and therapeutic comparison when ambiguous. Keep a concise English summary: GSE, drug, short drug description, n(A vs B), suitability, note. Prepare a disease-relevant gene panel; do not spend extra work checking every suggested gene against the assay unless requested.

## Input

1. Inspect GEO metadata and available processed expression files. Keep downloaded sources in the project. Do not substitute single-cell, microarray, FASTQ, a DEG-only table or incompatible tissues for a bulk expression matrix.
2. Use `prepare_import` for a staging folder and bundled Python. If necessary write and run an explicit adapter there, retaining its source. Select a complete expression block and record its actual unit. Preserve the first data row, original feature IDs and all valid assay rows, including rows without symbols. Do not interpret numeric expression values as sample IDs. A missing gene-column header in an R-exported table can use `recipe.row_names=true` and `gene_column="__feature_id__"`.
3. Explicitly map each sample column using GSM title, description/library ID or other attributable metadata. Provide evidence `{source,locator,value}` for each sample; retain subject, batch, tissue and biological replicate identity where available. Resolve collisions/technical replicates with a recorded rule. Do not guess an ambiguous mapping.
4. Register with `import_dataset`, supplying organism (human or mouse), recipe, sample records and adapter_path. Counts must retain the original integer counts; estimated counts and CPM/TPM/FPKM/RPKM use their own units. Confirmed log2 expression must be documented as such; VST/rlog/z-scores are not interchangeable with log2. Automatic symbol lookup is secondary and must not restrict count library size or the tested universe.

## Analysis and display

Configure one tissue/cohort per comparison with sample IDs mapped to `Group A`, `Group B` or `N/A`. State what A and B mean; effects are B versus A. For paired data retain `blocking_fields:["subject"]`; verified batch fields may be included. Do not add confounded fields or silently ignore pairs. An incomplete/nonestimable design returns an error to resolve.

Count inputs use TMM, expression filtering and limma-voom. Supported normalized inputs use log2(value+0.1) and limma-trend. The method, full feature universe, design and package versions are saved with each run. Gene panel/cutoff changes do not alter FDR. Changing included samples requires a new run; preview values carry no old p-values.

PCA uses one compatible cohort, independently of the gene panel or DEG significance. It can run before differential analysis. Default: log expression, variable eligible genes, up to 500, gene centering without unit-variance scaling. Do not claim that separation proves treatment causality or that a distant sample is automatically invalid.

`start_analysis` returns a job ID. Check `get_job` at sensible intervals; cancellation is explicit. A completed historical job may not be applied if sample selection changed. Viewer receipts distinguish calculation from display. Use stable comparison IDs for view selections and names for hidden genes. Show Trend/MA/Heatmap/PCA with `update_view`, preserving user edits. Export the concise dataset summary, panel and source-inclusive project bundle. Explain genuine limitations briefly.

Existing Cell 4 workbooks may be imported with `legacy:true`. Their normalized expression can be displayed/reanalysed, but absent original counts or pairing metadata must not be invented.
