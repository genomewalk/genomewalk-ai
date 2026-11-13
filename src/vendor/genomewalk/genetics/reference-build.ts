// Shared aliases for human reference builds. Match complete names, not arbitrary
// occurrences of 37/38 (or a provider's software/annotation version).
const aliases = {
  GRCh37:
    /(?:grch[\s_-]*37(?:\.p\d+)?|hg[\s_-]*19|ncbi[\s_-]*37|b37|hs37d5|hs37|human_g1k_v37|(?:build|assembly)[\s_:= -]*37(?:\.\d+)?)/i,
  GRCh38:
    /(?:grch[\s_-]*38(?:\.p\d+)?|hg[\s_-]*38|ncbi[\s_-]*38|(?:build|assembly)[\s_:= -]*38(?:\.\d+)?)/i,
  NCBI36: /(?:ncbi[\s_-]*36|hg[\s_-]*18|(?:build|assembly)[\s_:= -]*36(?:\.\d+)?)/i,
  "T2T-CHM13": /(?:chm13(?:v?\d+(?:\.\d+)*)?|hs1)/i,
};

export type ReferenceBuild = keyof typeof aliases;
export type SupportedBuild = "GRCh37" | "GRCh38";

export function detectReferenceBuild(hints: string[]) {
  const text = hints.join("\n");
  const builds = (Object.keys(aliases) as ReferenceBuild[]).filter((build) =>
    new RegExp(`(?<![a-z0-9])${aliases[build].source}(?![a-z0-9])`, "i").test(text),
  );
  return builds.length > 1 ? "conflicting" : builds[0] || "unknown";
}
