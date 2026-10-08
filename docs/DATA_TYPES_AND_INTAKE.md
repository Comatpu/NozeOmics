# Data types and GEO intake

The application has three screens: Projects (startup), New project/intake, and Analysis.
Project status and source caches are persisted in NozeOmics_data. Existing projects
open their saved Analysis; unfinished projects resume intake. There is no Next or
Approve control in the frontend. The local MCP reviewer approves batches.

## Assay classification

| Internal type | Meaning | Operations |
| --- | --- | --- |
| raw_count | Integer gene-by-sample read counts | Trend, MA, sample Heatmap/PCA, differential analysis |
| estimated_count | Estimated counts, possibly fractional | Same, with explicit quantification provenance |
| CPM | Counts per million | Same, with normalized-expression analysis |
| TPM | Transcripts per million | Same, subject to comparability and design review |
| FPKM | Fragments per kilobase per million | Same, subject to comparability and design review |
| RPKM | Reads per kilobase per million | Same, subject to comparability and design review |
| log2 | Confirmed log2-normalized expression | Same; do not log-transform again |
| de_result | Submitted differential-expression results | Submitted log2FC in Trend; MA if average expression exists on a confirmed scale |
| filtered_de | Submitted subset of DE results | Same, explicitly marked as a gene subset |
| raw_sequence | FASTQ/BAM | Retain provenance; requires preprocessing outside first-version automatic analysis |
| unknown | Assay meaning not confirmed | Await review; never infer a statistical input from the extension or filename |

Containers (CSV, TSV, Excel, gzip, tar, etc.), assay meaning, gene/transcript
level, identifier system, transformation history and support capabilities are
separate concepts. Generalization preserves the original file and values;
the recorded recipe/adapter describes selected columns and changes. Matrix
analysis requires verified independent biological replicates and an appropriate
design. Count and normalized-expression inputs use different model paths.

DE result import requires an explicit full/filtered classification, gene and
effect columns, log2 effect scale, and original comparison direction. A/B effects
are inverted only when explicitly declared. Average expression requires a
declared log2/log10/linear scale; linear transformation requires a recorded offset.
Missing P values remain missing. Sample expression is never reconstructed from
effects or P values. Result-only data cannot recalculate statistics or create
sample PCA/Heatmap. Filtered results cannot represent the full tested universe.

## Intake and AI review

1. `add_gses` adds several accessions immediately. At most two background workers
   retrieve full GEO SOFT metadata, GSM information and the supplementary file inventory.
   Source files are never automatically downloaded at this stage.
   SRA read archives are referenced by GEO metadata and need separate acquisition
   and preprocessing; this flow does not pretend that an SRA link is an assay.
2. The frontend displays reports, GSM metadata/group assignments and file names,
   sizes and retrieval status. It displays no matrix preview or parsing recipe.
3. `get_intake` exposes full local metadata/source paths, source hashes, the current
   user group assignments, paginated samples and a review fingerprint. The AI
   first reviews metadata and calls `select_intake_files` with only the necessary
   file IDs and a rationale. A separate single download worker retrieves those files
   and reuses verified caches. The AI then inspects sources using `inspect_source`
   or a recorded adapter in staging.
4. `import_dataset` retains a validated matrix and mapping evidence;
   `configure_comparison` must match the user's Control/Treated GSM assignments.
   `import_results` retains a submitted result table with its definition.
5. `review_intake` records approve/return decisions, rationale, accepted dataset IDs
   and the current fingerprint. Submitted results also require contrast evidence;
   failed selected source files require an explicit limitations statement.
   Unselected inventory files do not block approval. The review
   credential is available to MCP but is not sent to the frontend bootstrap.
6. Returned GSEs remain visible for correction/removal. Approved normalized inputs
   and existing valid runs remain cached. Group/source changes invalidate that
   GSE's approval, while other approvals remain intact. Cache bytes are preserved.
7. When every retained GSE passes, matrix comparisons are calculated using their
   original assays and designs. Analysis opens automatically only when those
   results are current. A calculation failure returns the affected GSE to intake.
   Result-only GSEs do not require or imitate a matrix calculation.

Stopping the program during retrieval/processing leaves a resumable intake with
an interruption message. Acquisition retries reuse source files with matching
hashes. Project/GSE removal does not recursively delete original caches.

During development, use scripts/run-dev.ps1. The portable EXE is an independent
frozen snapshot and is not rebuilt for routine UI changes.
