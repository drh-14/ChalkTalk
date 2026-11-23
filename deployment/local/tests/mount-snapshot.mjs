// Docker inspect does not define mount-array ordering. Docker Desktop can also
// report a host bind path with or without its /host_mnt VM prefix after restart.
// Keep every other field and the underlying host path in the comparison.
export function mountSnapshot(serialized) {
  return JSON.parse(serialized)
    .map((mount) => ({
      ...mount,
      Source:
        mount.Type === "bind" && mount.Source?.startsWith("/host_mnt/")
          ? mount.Source.slice("/host_mnt".length)
          : mount.Source,
    }))
    .sort((left, right) => left.Destination.localeCompare(right.Destination));
}
