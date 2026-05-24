import { formatIPv4, formatMAC, parseIPv4, validate_ip } from "../format";
import type { TArpRecord } from "../os/arp";
import type { OS } from "../os/os";

export async function arp(os: OS, args: string[]) {
  if (!args.length) {
    if (!os.net.arp._table.length) os.print("empty\n");

    for (const rec of os.net.arp._table) {
      const iface = os.net._interfaces[rec.iInterface];
      os.print(`${formatIPv4(rec.ip)} at ${formatMAC(rec.mac)} on ${iface.name} [${rec.state}]\n`);
    }
  } else if (args[0] === "who" && validate_ip(args[1])) {
    const who_ip = parseIPv4(args[1]);

    let iface_index = -1;

    if (args[2] === "on" && args[3]) {
      iface_index = os.net._interfaces.findIndex((i) => i.name === args[3]);
      if (iface_index === -1) throw new Error("Interface not found");
    } else {
      const route = os.net.ip4.route(who_ip);
      if (!route) throw new Error("No route to host");

      iface_index = route.iInterface;
    }

    const iface = os.net._interfaces[iface_index];
    if (!iface.mac) throw new Error("Interface has no MAC");
    if (!iface.ips.length) throw new Error("Interface has no IPs");

    os.print("Request...");

    os.net.arp.send_request(iface_index, who_ip);

    let arp: TArpRecord | undefined;

    const dl = os.deadline(1000);
    while (dl.left) {
      arp = os.net.arp.get_record(iface_index, who_ip);
      if (arp && arp.state !== "pending") break;
      const [, err] = await os.channel_sync(os.net.arp._channel, dl);
      if (err) throw err;
    }
    
    if (arp) {
      os.print(`${arp.state}\n${formatMAC(arp.mac)}\n`);
    } else {
      os.print(`not found\n`);
    }
  } else {
    os.print("Usage:\n");
    os.print("[who <ip> [on <interface>]]\n");
  }
}
