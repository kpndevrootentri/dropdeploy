import { diskUsageFromDf } from '@/lib/disk-usage';

describe('diskUsageFromDf', () => {
  it('reads the per-type totals of API 1.52 and later', () => {
    expect(diskUsageFromDf({
      ImageUsage: { TotalCount: 4, TotalSize: 1000, Reclaimable: 600 },
      ContainerUsage: { TotalCount: 3, TotalSize: 50, Reclaimable: 10 },
      VolumeUsage: { TotalCount: 2, TotalSize: 70, Reclaimable: 0 },
      BuildCacheUsage: { TotalCount: 9, TotalSize: 300, Reclaimable: 200 },
    })).toEqual({
      images: { count: 4, sizeBytes: 1000, reclaimableBytes: 600 },
      containers: { count: 3, sizeBytes: 50 },
      volumes: { count: 2, sizeBytes: 70 },
      buildCache: { sizeBytes: 300, reclaimableBytes: 200 },
    });
  });

  it('totals the per-object lists of older daemons, skipping sizes Docker did not compute', () => {
    expect(diskUsageFromDf({
      LayersSize: 1000,
      Images: [
        { Size: 400, SharedSize: 100, Containers: 1 },
        { Size: 500, SharedSize: 100, Containers: 0 },
      ],
      Containers: [{ SizeRw: 20 }, { SizeRw: -1 }, {}],
      Volumes: [{ UsageData: { Size: 70 } }, { UsageData: { Size: -1 } }, { UsageData: null }],
      BuildCache: [
        { Size: 100, InUse: true, Shared: false },
        { Size: 200, InUse: false, Shared: false },
        { Size: 999, InUse: false, Shared: true },
      ],
    })).toEqual({
      images: { count: 2, sizeBytes: 1000, reclaimableBytes: 700 },
      containers: { count: 3, sizeBytes: 20 },
      volumes: { count: 3, sizeBytes: 70 },
      buildCache: { sizeBytes: 300, reclaimableBytes: 200 },
    });
  });
});
