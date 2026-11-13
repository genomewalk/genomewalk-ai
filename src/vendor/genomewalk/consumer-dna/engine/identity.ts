export const normChrom = (c: string) => {
  const x = String(c).replace(/^chr/i, "").toUpperCase();
  return x === "M" ? "MT" : x;
};

export const varKey = (chrom: string, pos: string | number, ref: string, alt: string) =>
  `${normChrom(chrom)}:${pos}:${ref}:${alt}`;
