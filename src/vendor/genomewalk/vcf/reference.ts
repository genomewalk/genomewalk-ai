import { detectReferenceBuild } from "../genetics/reference-build.ts";

// Primary chromosome lengths from UCSC hg19/hg38 *.chrom.sizes. Ignore mtDNA,
// whose reference sequence varies between distributions of the same build.
const lengths: Record<string, [number, number]> = {
  1: [249250621, 248956422],
  2: [243199373, 242193529],
  3: [198022430, 198295559],
  4: [191154276, 190214555],
  5: [180915260, 181538259],
  6: [171115067, 170805979],
  7: [159138663, 159345973],
  8: [146364022, 145138636],
  9: [141213431, 138394717],
  10: [135534747, 133797422],
  11: [135006516, 135086622],
  12: [133851895, 133275309],
  13: [115169878, 114364328],
  14: [107349540, 107043718],
  15: [102531392, 101991189],
  16: [90354753, 90338345],
  17: [81195210, 83257441],
  18: [78077248, 80373285],
  19: [59128983, 58617616],
  20: [63025520, 64444167],
  21: [48129895, 46709983],
  22: [51304566, 50818468],
  X: [155270560, 156040895],
  Y: [59373566, 57227415],
};

function contigs(meta: string[]) {
  return meta.flatMap((line) => {
    const value = /^##contig\s*=\s*<(.*)>\s*$/i.exec(line)?.[1];
    if (!value) return [];
    const fields = Object.fromEntries(
      [...value.matchAll(/(?:^|,)\s*(\w+)\s*=\s*("(?:\\.|[^"\\])*"|[^,>]*)/g)].map((match) => [
        match[1]!.toLowerCase(),
        match[2]!.trim().replace(/^"|"$/g, ""),
      ]),
    );
    return [
      {
        chrom: (fields["id"] || "").replace(/^chr/i, "").toUpperCase(),
        length: Number(fields["length"]),
        assembly: fields["assembly"] || "",
      },
    ];
  });
}

export function detectBuild(meta: string[]) {
  // Only reference declarations count. Tool commands and INFO descriptions can
  // mention other builds without describing this file's coordinate system.
  const hints = meta.flatMap((line) => {
    const value = /^##(?:reference|reference[_-]?build|genome[_-]?build)\s*=\s*(.*)$/i.exec(
      line,
    )?.[1];
    return value ? [value] : [];
  });
  for (const contig of contigs(meta)) {
    hints.push(contig.assembly);
    const known = lengths[contig.chrom];
    if (known?.[0] === contig.length) hints.push("GRCh37");
    if (known?.[1] === contig.length) hints.push("GRCh38");
    if (contig.chrom === "1" && contig.length === 248387328) hints.push("T2T-CHM13");
  }
  return detectReferenceBuild(hints);
}

export const genomeLen = (meta: string[]) =>
  contigs(meta)
    .filter(({ chrom }) => /^(?:[1-9]|1[0-9]|2[0-2]|X|Y|MT|M)$/.test(chrom))
    .reduce((total, { length }) => total + (Number.isFinite(length) ? length : 0), 0);
