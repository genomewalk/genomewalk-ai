import { AppError } from "../../app-error.ts";
import { detectReferenceBuild } from "../../genetics/reference-build.ts";

export function detectHeaderProvider(meta: string[]): "23andMe" | "AncestryDNA" | null {
  // Reuse existing lines when reporting a failure, including allocation failures.
  return meta.some((line) => /23andme/i.test(line))
    ? "23andMe"
    : meta.some((line) => /ancestrydna/i.test(line))
      ? "AncestryDNA"
      : null;
}

export function describeHeader(meta: string[], columns: string[]) {
  const text = meta.join("\n");
  const provider = detectHeaderProvider(meta);
  const normalizedColumns = columns.map((x) => x.toLowerCase().replace(/\s+/g, "")).join("|");
  const layout =
    normalizedColumns === "rsid|chromosome|position|genotype"
      ? "genotype"
      : normalizedColumns === "rsid|chromosome|position|allele1|allele2"
        ? "allele-pair"
        : "other";
  const expectedLayout = provider === "23andMe" ? "genotype" : "allele-pair";
  if (!provider || layout !== expectedLayout)
    throw new AppError(
      "DNA_FORMAT_UNSUPPORTED",
      !provider
        ? "We found DNA-style columns, but couldn’t identify a supported provider in the file header. Choose an original raw 23andMe or AncestryDNA export, or try the public sample."
        : `The file header mentions ${provider}, but its columns don’t match that provider’s raw export. Download a fresh raw export from ${provider}, or try the public sample.`,
      {
        formatReason: provider ? "columns-mismatch" : "provider-unrecognized",
        headerProvider: provider || "unrecognized",
        headerLayout: layout,
      },
    );
  const headerBuild = detectReferenceBuild(meta);
  const hasBuildMetadata =
    headerBuild !== "unknown" ||
    /\b(?:reference|assembly|build|(?:GRCh|NCBI|hg)[\s_-]*\d+|GC[AF]_\d+(?:\.\d+)?)\b/i.test(text);
  // Ancestry's documented raw export profile supplies build/strand when omitted
  // from its header. Explicit contradictory metadata always wins over defaults.
  const useProviderBuild = !hasBuildMetadata && provider === "AncestryDNA";
  const build = useProviderBuild ? "GRCh37" : headerBuild;
  const negative = /(?:minus|negative|reverse|\(-\))\s+strand/i.test(text);
  const positive = /(?:plus|positive|forward|\(\+\))\s+strand/i.test(text);
  const strand = negative ? (positive ? "conflicting" : "reverse") : "forward";
  return {
    provider,
    build,
    strand,
    buildSource: useProviderBuild
      ? "documented AncestryDNA format"
      : hasBuildMetadata
        ? "file header"
        : "not supplied",
    strandSource: positive || negative ? "file header" : "documented provider format",
  };
}
