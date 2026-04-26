export function hexdump(data: Uint8Array) {
  return [...data].map((d) => d.toString(16).padStart(2, "0")).join(" ");
}

export function formatMAC(mac: bigint) {
  return mac.toString(16).padStart(12, "0").match(/(..)/g)?.join(":");
}

export function formatIPv4(ip: number) {
  return ip
    .toString(16)
    .padStart(8, "0")
    .match(/(..)/g)
    ?.map((d) => parseInt(d, 16))
    .join(".");
}

export function parseIPv4(ip: string) {
  const parts = ip.split(".");
  let ip_int = 0;
  for (let i = 0; i < parts.length; i++) {
    ip_int |= parseInt(parts[i], 10) << ((3 - i) * 8);
  }
  return ip_int >>> 0;
}
