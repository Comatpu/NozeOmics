args <- commandArgs(trailingOnly=TRUE)
work <- args[[1]]
mode <- args[[2]]
unit <- args[[3]]
blocking <- if (length(args) >= 4 && nchar(args[[4]])) strsplit(args[[4]], ',')[[1]] else character()
suppressPackageStartupMessages(library(limma))
values <- as.matrix(read.delim(file.path(work, 'matrix.tsv'), row.names=1, check.names=FALSE))
storage.mode(values) <- 'double'
meta <- read.delim(file.path(work, 'samples.tsv'), check.names=FALSE, colClasses='character')
stopifnot(identical(colnames(values), meta$id), all(is.finite(values)))
counts <- unit %in% c('raw_count', 'estimated_count')
if (counts) {
  suppressPackageStartupMessages(library(edgeR))
  if (any(values < 0) || any(colSums(values) <= 0)) stop('Invalid count libraries')
  dge <- calcNormFactors(DGEList(counts=values), method='TMM')
  logvalues <- cpm(dge, log=TRUE, prior.count=0.25)
} else {
  logvalues <- if (unit == 'log2') values else log2(values + 0.1)
}
write.table(logvalues, file.path(work, 'expression.tsv'), sep='\t', quote=FALSE, col.names=NA)
version_lines <- c(paste('R', getRversion()), paste('limma', packageVersion('limma')), if (counts) paste('edgeR', packageVersion('edgeR')), capture.output(sessionInfo()))
writeLines(version_lines, file.path(work, 'environment.txt'))
if (mode == 'transform') quit(status=0)
if (!all(meta$group %in% c('Group A', 'Group B'))) stop('Comparison contains non-A/B samples')
meta$condition <- factor(meta$group, levels=c('Group A', 'Group B'))
for (field in blocking) {
  if (!field %in% names(meta) || any(!nzchar(meta[[field]]))) stop(paste('Missing design field:', field))
  meta[[field]] <- factor(meta[[field]])
  if (nlevels(meta[[field]]) < 2) stop(paste('Design field has only one level:', field))
}
design <- model.matrix(reformulate(c(blocking, 'condition')), data=meta)
if (qr(design)$rank < ncol(design)) stop('Design is confounded or not full rank; treatment effect is not estimable')
if (nrow(design) <= ncol(design)) stop('No residual degrees of freedom for differential testing')
if (any(table(meta$condition) < 2)) stop('Differential testing requires at least two biological samples per group')
if ('subject' %in% blocking) {
  pairs <- table(meta$subject, meta$condition)
  if (any(rowSums(pairs > 0) < 2)) stop('Paired comparison has incomplete subjects; explicitly choose complete pairs')
}
if (counts) {
  keep <- filterByExpr(dge, design=design)
  if (sum(keep) < 2) stop('Too few expressed genes for differential analysis')
  fit <- lmFit(voom(dge[keep,,keep.lib.sizes=TRUE], design=design, plot=FALSE), design)
  fit <- eBayes(fit)
} else {
  keep <- apply(logvalues, 1, function(x) all(is.finite(x)) && var(x) > 0)
  if (sum(keep) < 2) stop('Too few variable genes for differential analysis')
  fit <- eBayes(lmFit(logvalues[keep,,drop=FALSE], design), trend=TRUE)
}
testing <- data.frame(feature_id=rownames(values), reason=ifelse(keep, '', if (counts) 'low_expression' else 'non_variable'))
write.table(testing, file.path(work, 'testing.tsv'), sep='\t', quote=FALSE, row.names=FALSE)
result <- topTable(fit, coef=ncol(design), number=Inf, sort.by='none', adjust.method='BH')
result$feature_id <- rownames(result)
write.table(result, file.path(work, 'results.tsv'), sep='\t', quote=FALSE, row.names=FALSE)
write.table(design, file.path(work, 'design.tsv'), sep='\t', quote=FALSE, col.names=NA)
writeLines(paste('Formula:', deparse(reformulate(c(blocking, 'condition')))), file.path(work, 'design.txt'))
