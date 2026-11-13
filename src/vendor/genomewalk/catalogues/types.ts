export interface VariantIdentity {
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
}
export interface CatalogEntry extends VariantIdentity {
  sig: string;
  stars: number;
  gene: string;
  conditions: string;
  af: number | null;
  grp: string;
  afmax: number | null;
  an: number | null;
  variationId: string;
  alleleId: string;
  rawSig: string;
  reviewStatus: string;
  rsIds: string;
  hgvs: string;
  pmids: string[];
  releaseDate: string;
  citationDate: string;
  conflictingSig: string;
  gnomadKey: string;
  conditionMedgenIds: string;
  gnomadAc?: number | null;
  gnomadFilter?: string;
  gnomadDiscordanceP?: number | null;
}
export interface Evidence {
  sig: string;
  stars: number;
  afmax?: number | null;
  rawSig?: string;
  reviewStatus?: string;
  partialCall?: boolean;
  conflictingRecords?: boolean;
}
/** Small public summary; never contains the catalogue's complete key list or row locators. */
export interface CatalogueMetadata {
  schema: 1;
  build: string;
  source: { size: number; sha256: string };
  chromosomes: string[];
  n: number;
  header: string;
  byClass: Record<string, number>;
  byStars: Record<string, number>;
  sample: string[];
  examples: string[];
}
export interface StudyCitation {
  label: string;
  url: string;
}
export interface Marker extends VariantIdentity {
  rs: string;
  cat: string;
  gene: string;
  title: string;
  read: string[];
  effIsAlt: boolean;
  af: number | null;
  pops: Record<string, number | null>;
  source?: string;
  gnomadKey?: string;
  gnomadFilter?: string;
  gnomadDiscordanceP?: number | null;
  cite?: StudyCitation | StudyCitation[];
  studyNote?: string;
}
export interface MarkerData {
  build: string;
  dataset?: string;
  pops: Record<string, string>;
  markers: Marker[];
}
