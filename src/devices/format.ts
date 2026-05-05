export function formatTime(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 1000 * 60) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 1000 * 60 * 60) return `${(ms / 1000 / 60).toFixed(2)}m`;
  if (ms < 1000 * 60 * 60 * 24) return `${(ms / 1000 / 60 / 60).toFixed(2)}h`;
  if (ms < 1000 * 60 * 60 * 24 * 365) return `${(ms / 1000 / 60 / 60 / 24).toFixed(2)}d`;
  return `${(ms / 1000 / 60 / 60 / 24 / 365).toFixed(2)}y`;
}

export function prefixToMask(prefix: number) {
  if (prefix === 24) return 0xffffff00;
  if (prefix === 0) return 0;
  return 0xffffffff - Number((1n << (32n - BigInt(prefix))) - 1n);
}

export function testSameNetwork(test_ip: number, ip: number, prefix: number) {
  const mask = prefixToMask(prefix);
  return (ip & mask) === (test_ip & mask);
}

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

export function parseMAC(mac: string) {
  return BigInt(`0x${mac.replace(/:/g, "")}`);
}

export function validate_ip(ip: string) {
  if (!/\d+\.\d+\.\d+\.\d+/.test(ip)) return false;
  for (const part of ip[0].split(".")) {
    const int = parseInt(part);
    if (int > 255) return false;
  }
  return true;
}

export function validate_address(address: string) {
  if (!/\d+\.\d+\.\d+\.\d+\/\d+/.test(address)) return false;
  const parts = address.split("/");
  const prefix = parseInt(parts[1]);
  if (prefix > 32) return false;
  if (!validate_ip(parts[0])) return false;
  return true;
}

export function validate_mac(mac: string) {
  if (!/([0-9a-f]{2}:){5}[0-9a-f]{2}/i.test(mac)) return false;
  return true;
}
