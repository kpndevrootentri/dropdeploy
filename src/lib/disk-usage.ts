/** Docker's disk usage as totals only: no image, container or volume names, labels or env. */
export interface DiskUsage {
  images: { count: number; sizeBytes: number; reclaimableBytes: number };
  containers: { count: number; sizeBytes: number };
  volumes: { count: number; sizeBytes: number };
  buildCache: { sizeBytes: number; reclaimableBytes: number };
}

interface RawTotals {
  TotalCount?: number;
  TotalSize?: number;
  Reclaimable?: number;
}

/**
 * The fields of `GET /system/df` read here. API 1.52 added per-type totals;
 * 1.53 dropped the per-object lists older daemons return instead.
 */
export interface RawDiskUsage {
  ImageUsage?: RawTotals;
  ContainerUsage?: RawTotals;
  VolumeUsage?: RawTotals;
  BuildCacheUsage?: RawTotals;
  LayersSize?: number;
  Images?: { Size: number; SharedSize: number; Containers: number }[];
  Containers?: { SizeRw?: number }[];
  Volumes?: { UsageData?: { Size: number } | null }[];
  BuildCache?: { Size: number; InUse: boolean; Shared: boolean }[];
}

/** Docker reports -1 for a size it did not compute. */
const sum = (sizes: (number | undefined)[]): number =>
  sizes.reduce<number>((total, size) => total + (size && size > 0 ? size : 0), 0);

export function diskUsageFromDf(df: RawDiskUsage): DiskUsage {
  if (df.ImageUsage) {
    const { ImageUsage: i, ContainerUsage: c, VolumeUsage: v, BuildCacheUsage: b } = df;
    return {
      images: { count: i.TotalCount ?? 0, sizeBytes: i.TotalSize ?? 0, reclaimableBytes: i.Reclaimable ?? 0 },
      containers: { count: c?.TotalCount ?? 0, sizeBytes: c?.TotalSize ?? 0 },
      volumes: { count: v?.TotalCount ?? 0, sizeBytes: v?.TotalSize ?? 0 },
      buildCache: { sizeBytes: b?.TotalSize ?? 0, reclaimableBytes: b?.Reclaimable ?? 0 },
    };
  }

  // Older daemons: total the lists the way `docker system df` does.
  const images = df.Images ?? [];
  const imagesSize = df.LayersSize ?? 0;
  const imagesInUse = sum(images.filter((i) => i.Containers > 0 && i.SharedSize >= 0).map((i) => i.Size - i.SharedSize));
  const cache = (df.BuildCache ?? []).filter((c) => !c.Shared);
  return {
    images: { count: images.length, sizeBytes: imagesSize, reclaimableBytes: Math.max(0, imagesSize - imagesInUse) },
    containers: { count: df.Containers?.length ?? 0, sizeBytes: sum((df.Containers ?? []).map((c) => c.SizeRw)) },
    volumes: { count: df.Volumes?.length ?? 0, sizeBytes: sum((df.Volumes ?? []).map((v) => v.UsageData?.Size)) },
    buildCache: {
      sizeBytes: sum(cache.map((c) => c.Size)),
      reclaimableBytes: sum(cache.filter((c) => !c.InUse).map((c) => c.Size)),
    },
  };
}
