import { formatIPv4, formatTime, parseIPv4, validate_ip } from "../format";
import type { OS } from "../os";
import { pack_icmp_packet, pack_ip4_packet, unpack_icmp_packet, unpack_ip4_packet } from "../pack";

export async function ping(os: OS, args: string[]) {
  if (validate_ip(args[0])) {
    const ip = parseIPv4(args[0]);

    function find_config(key: string, initial: string = "") {
      for (let i = 1; i < args.length; i++) {
        if (args[i] === key && args[i + 1]) {
          return args[i + 1];
        }
      }

      return initial;
    }

    const count = parseInt(find_config("-c", "1"));
    if (Number.isNaN(count) || count < 0) throw new Error("Invalid count");

    const size = parseInt(find_config("-s", "56"));
    if (Number.isNaN(size) || size < 0) throw new Error("Invalid packet size");

    const timeout = parseInt(find_config("-t", "1000"));
    if (Number.isNaN(timeout) || timeout < 0) throw new Error("Invalid timeout");

    const ttl = parseInt(find_config("-m", "64"));
    if (Number.isNaN(ttl) || ttl < 0 || ttl > 255) throw new Error("Invalid TTL");

    const wait = parseInt(find_config("-i", "1000"));
    if (Number.isNaN(wait) || wait < 0) throw new Error("Invalid wait");

    os.print(`PING ${formatIPv4(ip)}: ${size} data bytes\n`);

    const route = os.net_ip4_route(ip);
    if (!route) throw new Error("No route to host");

    for (let i = 0; i < count; i++) {
      if (i) await new Promise((resolve) => setTimeout(resolve, wait));

      const id = Math.floor(Math.random() * 65535);
      const seq = i;
      const rest = new Uint8Array([id >> 8, id & 0xff, seq >> 8, seq & 0xff]);

      const packet = pack_ip4_packet({
        header: {
          version: 4,
          dst: ip,
          src: route.src,
          protocol: 1,
          ttl,
          flags: 0,
          id: 0,
          ihl: 0,
          length: 0,
          offset: 0,
          options: [],
          tos: 0,
          checksum: 0,
        },
        payload: pack_icmp_packet({
          type: 8,
          code: 0,
          rest,
          payload: new Uint8Array(size),
          checksum: 0,
        }),
      });

      os.net_ip4_send_packet(route.iInterface, route.gateway, packet);

      const start = Date.now();

      const dl = os.deadline(timeout);
      while (dl.left) {
        const [msg, err] = await os.channel_sync(os._netIp4Channel, dl);
        if (err || !msg) {
          os.print(`timeout for seq=${seq}/${count - 1}\n`);
          break;
        }

        const time = Date.now() - start;

        if (msg.direction !== "in") continue;

        const ip_struct = unpack_ip4_packet(msg.packet);
        if (ip_struct.header.src !== ip) continue;
        if (ip_struct.header.protocol !== 1) continue;

        const icmp_struct = unpack_icmp_packet(ip_struct.payload);
        if (icmp_struct.type !== 0) continue;

        let rest_eq = true;
        for (let j = 0; j < rest.length; j++) {
          if (rest[j] !== icmp_struct.rest[j]) {
            rest_eq = false;
            break;
          }
        }
        if (!rest_eq) continue;

        os.print(
          `${ip_struct.payload.length} bytes seq=${seq}/${count - 1} ttl=${ip_struct.header.ttl} time=${formatTime(time)}\n`,
        );
        break;
      }
    }

    os.print("done\n");
    return;
  }

  os.print("Usage: <ip> [-c count] [-s packet_size] [-t timeout_ms] [-m TTL] [-i wait_ms]\n");
}
