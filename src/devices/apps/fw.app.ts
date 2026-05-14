import { formatIPv4, formatTime } from "../format";
import type { OS } from "../os/os";
import { IP_PROTOCOLS } from "../pack";

export async function connection(os: OS, args: string[]) {
  if (args.length) throw new Error("No arguments expected");

  for (const c of os.net.ip4.tracker._table) {
    os.print(`${formatIPv4(c.src)}:${c.src_port} -> ${formatIPv4(c.dst)}:${c.dst_port} [`);
    if (c.protocol === IP_PROTOCOLS.TCP) {
      os.print("TCP");
    } else if (c.protocol === IP_PROTOCOLS.UDP) {
      os.print("UDP");
    } else if (c.protocol === IP_PROTOCOLS.ICMP) {
      os.print("ICMP");
    } else {
      os.print(c.protocol.toString());
    }
    os.print("]\n");

    if (c.protocol === IP_PROTOCOLS.ICMP && c.icmp) {
      os.print(`\ttype: ${c.icmp.type}\n`, `\tcode: ${c.icmp.code}\n`, `\tid: ${c.icmp.id}\n`);
    } else if (c.protocol === IP_PROTOCOLS.TCP && c.tcp) {
      os.print(`\tstate: ${c.tcp.state}\n`);
    }

    os.print(`\treply: ${c.has_reply ? "yes" : "no"}\n`);
    os.print("\ttimeout: ", formatTime(c.expires_at - Date.now()), "\n");
  }
}
