# Public teaching sample: HG002

`HG002_GRCh38.vcf.gz` is an unmodified copy of NIST Genome in a Bottle's
`HG002_GRCh38_v5.0q_smvar.vcf.gz`. BGZF is gzip-compatible, and the standard `.gz`
extension lets GitHub Pages serve the compressed file without adding HTTP
compression. Its contents and published checksums are unchanged.

- Sample: HG002 / NA24385, from the broadly consented Personal Genome Project.
- Reference build: GRCh38.
- Release: GIAB v5.0q.
- Size: 42,067,644 bytes (42 MB decimal).
- MD5: `c71acc71069bf7cd7f51eb8fb0c1a1ab` — matches NIST's published checksum.
- SHA-256: `c7f9d7a4781f1f0a8a42ec54b051d6b95db1935c5e12318bae219740f9c50dc8`.
- Verified against the upstream release on 2026-09-13.

[Original VCF](https://ftp-trace.ncbi.nlm.nih.gov/ReferenceSamples/giab/release/AshkenazimTrio/HG002_NA24385_son/v5.0q/HG002_GRCh38_v5.0q_smvar.vcf.gz)
· [Checksums](https://ftp-trace.ncbi.nlm.nih.gov/ReferenceSamples/giab/release/AshkenazimTrio/HG002_NA24385_son/v5.0q/checksum.md5)
· [Release README and data-use terms](https://ftp-trace.ncbi.nlm.nih.gov/ReferenceSamples/giab/release/AshkenazimTrio/HG002_NA24385_son/v5.0q/NIST_HG002_v5.0q_variant-benchmarksets_README.md)

NIST recommends starting with HG002 because it has extensive trio data and broad
consent for public use: [GIAB FAQ](https://www.nist.gov/programs-projects/faqs-genome-bottle).
The GRCh38 VCF works with this site's GRCh38 catalogues and includes sex
chromosomes used in the file-counting lessons.

This is a benchmark variant call set used here to teach the VCF format, not a
complete clinical genome report. The `smvar` VCF also contains structural
variants. Accuracy benchmarking requires the matching BED regions as explained
in the release README; this teaching app does not perform accuracy benchmarking.
Counts describe the calls in this file, not every variant carried by the donor.

Data credit: National Institute of Standards and Technology, Genome in a Bottle
Consortium, and the [T2T Q100 project](https://github.com/marbl/hg002).
The release recommends citing the [HG002 assembly preprint](https://doi.org/10.1101/2025.09.21.677443).
