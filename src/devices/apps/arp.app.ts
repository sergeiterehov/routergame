import { formatIPv4, formatMAC, parseIPv4, validate_ip } from "../format";
import type { OS } from "../os/os";

export async function arp(os: OS, args: string[]) {
  if (!args.length) {
    if (!os._netARPTable.length) os.print("empty\n");

    for (const rec of os._netARPTable) {
      const iface = os._netInterfaces[rec.iInterface];
      os.print(`${formatIPv4(rec.ip)} at ${formatMAC(rec.mac)} on ${iface.name} [${rec.state}]\n`);
    }
  } else if (args[0] === "who" && validate_ip(args[1])) {
    const who_ip = parseIPv4(args[1]);

    let iface_index = -1;

    if (args[2] === "on" && args[3]) {
      iface_index = os._netInterfaces.findIndex((i) => i.name === args[3]);
      if (iface_index === -1) throw new Error("Interface not found");
    } else {
      const route = os.net_ip4_route(who_ip);
      if (!route) throw new Error("No route to host");

      iface_index = route.iInterface;
    }

    const iface = os._netInterfaces[iface_index];
    if (!iface.mac) throw new Error("Interface has no MAC");
    if (!iface.ips.length) throw new Error("Interface has no IPs");

    os.print("Request...");

    os.net_arp_send_request(iface_index, who_ip);

    let mac: bigint = -1n;

    const dl = os.deadline(1000);
    while (dl.left) {
      mac = os.net_arp_resolve(iface_index, who_ip);
      if (mac !== -1n) break;
      const [, err] = await os.channel_sync(os._netArpChannel, dl);
      if (err) throw err;
    }

    os.print("ok\n");
    os.print(`${formatMAC(mac)}\n`);
  } else {
    os.print("Usage:\n");
    os.print("[who <ip> [on <interface>]]\n");
  }
}
