import { formatIPv4, formatMAC, parseIPv4, validate_ip } from "../format";
import type { OS } from "../os";

export function arp(os: OS, args: string[]) {
  if (!args.length) {
    for (const rec of os._netARPTable) {
      if (rec.state !== "success") continue;
      const iface = os._netInterfaces[rec.iInterface];
      os.print(`${formatIPv4(rec.ip)} at ${formatMAC(rec.mac)} on ${iface.name}\n`);
    }
  } else if (args[0] === "who" && validate_ip(args[1]) && args[2] === "on" && args[3]) {
    const iface_index = os._netInterfaces.findIndex((i) => i.name === args[3]);
    if (iface_index === -1) throw new Error("Interface not found");

    const iface = os._netInterfaces[iface_index];
    if (!iface.mac) throw new Error("Interface has no MAC");
    if (!iface.ips.length) throw new Error("Interface has no IPs");

    const who_ip = parseIPv4(args[1]);

    os.net_arp_send_request(iface_index, who_ip);

    return;
  } else {
    os.print("Usage:\n");
    os.print("who <ip> on <interface>\n");
  }
}
