import type { Fetcher } from "../io/types.ts";
import { AppError } from "../app-error.ts";
import { fetchPublic, readPublicBytes, decodePublicJson } from "../io/fetch-public.ts";
import {
  publicationManifest,
  publicationLabels,
  publicationShard,
  validPmid,
} from "./publication-format.ts";
import type { PublicationLabels, PublicationManifest } from "./publication-format.ts";

/** Session-only public metadata cache. Only shards for requested citations are downloaded. */
export class PublicationCatalogue {
  private manifest: Promise<PublicationManifest> | undefined;
  private shards = new Map<string, Promise<PublicationLabels>>();
  private active = 0;
  private waiting: (() => void)[] = [];
  private readonly fetcher: Fetcher;
  private readonly onError: (error: unknown) => void;

  constructor(
    fetcher: Fetcher = (input, init) => fetch(input, init),
    onError: (error: unknown) => void = () => {},
  ) {
    this.fetcher = fetcher;
    this.onError = onError;
  }

  private index() {
    this.manifest ??= fetchPublic(
      "/ref/publications/index.json",
      "publication-index",
      {
        cache: "no-cache",
        signal: AbortSignal.timeout(15_000),
      },
      this.fetcher,
    )
      .then(async (response) => {
        const bytes = await readPublicBytes(response, "publication-index");
        return publicationManifest(decodePublicJson(bytes, "publication-index"));
      })
      .catch((error: unknown) => {
        this.manifest = undefined;
        this.onError(error);
        throw error;
      });
    return this.manifest;
  }

  private async readShard(key: string, sha: string) {
    if (this.active >= 4) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      const response = await fetchPublic(
        `/ref/publications/${key}.${sha}.json.gz`,
        "publication-labels",
        {
          signal: AbortSignal.timeout(15_000),
        },
        this.fetcher,
      );
      const bytes = await readPublicBytes(response, "publication-labels");
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      if (digest !== sha)
        throw new AppError(
          "REFERENCE_INTEGRITY_FAILED",
          "Publication shard does not match its manifest",
          { resource: "publication-labels" },
        );
      return publicationLabels(decodePublicJson(bytes, "publication-labels"), key);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  async load(ids: Iterable<string>): Promise<PublicationLabels> {
    const requested = [...new Set(ids)].filter(validPmid);
    if (!requested.length) return {};
    const manifest = await this.index();
    const keys = [...new Set(requested.map(publicationShard))];
    const loaded = await Promise.allSettled(
      keys.map((key) => {
        let pending = this.shards.get(key);
        if (!pending) {
          pending = this.readShard(key, manifest.shards[key]!).catch((error: unknown) => {
            this.shards.delete(key); // A later visit may retry; never cache a failed download.
            this.onError(error);
            throw error;
          });
          this.shards.set(key, pending);
        }
        return pending;
      }),
    );
    const available = new Map<string, PublicationLabels>();
    loaded.forEach((item, i) => {
      if (item.status === "fulfilled") available.set(keys[i]!, item.value);
    });
    return Object.fromEntries(
      requested.map((id) => [id, available.get(publicationShard(id))?.[id] ?? null]),
    );
  }
}
