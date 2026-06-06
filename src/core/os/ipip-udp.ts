import { SEC } from "../format";
import { setIntervalRecursive } from "../helpers";
import {
  IP_PROTOCOLS,
  pack_ip4_packet,
  pack_udp_packet,
  unpack_ip4_packet,
  unpack_udp_packet,
  type TIP4Packet,
} from "../pack";
import type { IP4 } from "./ip4";
import { NET_ERRORS } from "./net";

export type TIPIPUDPTun = {
  iInterface: number;
  local_ip: number;
  remote_ip: number;
  local_port: number;
  remote_port: number;
  active: boolean;
  passive: boolean;
  last_ping_at: number;
};

const _ACTIVE_INTERVAL = 5 * SEC;

const _ping_packet: TIP4Packet = {
  header: {
    version: 0,
    checksum: 0,
    dst: 0,
    flags: 0,
    id: 0,
    ihl: 0,
    length: 0,
    offset: 0,
    options: [],
    protocol: 0,
    src: 0,
    tos: 0,
    ttl: 0,
  },
  payload: new Uint8Array(),
};

export class IPIPUDP {
  _tuns: TIPIPUDPTun[] = [];

  constructor(readonly ip4: IP4) {
    setIntervalRecursive(this._handle_timer.bind(this), _ACTIVE_INTERVAL);
  }

  private _handle_timer() {
    const deadline = Date.now() - _ACTIVE_INTERVAL;

    for (const tun of this._tuns) {
      const iface = this.ip4.net.iface(tun.iInterface);

      if (!iface.flags.UP) continue;

      if (tun.active) {
        const err = this.send_packet(tun.iInterface, _ping_packet);
        if (err) iface.flags.RUNNING = false;
      }

      if (tun.passive) {
        if (tun.last_ping_at < deadline) {
          iface.flags.RUNNING = false;
          tun.remote_ip = 0;
          tun.remote_port = 1;
        }
      }
    }
  }

  handle_packet(iOuterInterface: number, packet: TIP4Packet): boolean {
    for (const tun of this._tuns) {
      if (tun.local_ip === packet.header.dst) {
        const udp = unpack_udp_packet(packet.payload);

        if (udp.header.dst === tun.local_port) {
          const iface = this.ip4.net.iface(tun.iInterface);

          if (tun.passive) {
            // If ok, save remote address
            tun.remote_ip = packet.header.src;
            tun.remote_port = udp.header.src;

            // Send reply
            const err = this.send_packet(iface.index, _ping_packet);
            if (err) return false;
          }

          iface.flags.RUNNING = true;
          tun.last_ping_at = Date.now();

          const inner = unpack_ip4_packet(udp.payload);

          // Do not handle ping packet
          if (inner.header.version === _ping_packet.header.version) {
            return true;
          }

          if (tun.remote_ip === packet.header.src && udp.header.src === tun.remote_port) {
            this.ip4.handle_packet(tun.iInterface, inner);
            return true;
          }
        }
      }
    }

    return false;
  }

  send_packet(iInnerInterface: number, packet: TIP4Packet): number {
    const tun = this._tuns.find((tun) => tun.iInterface === iInnerInterface);
    if (!tun) return NET_ERRORS.NO_ROUTE;

    const inner = pack_udp_packet({
      header: {
        src: tun.local_port,
        dst: tun.remote_port,
        checksum: 0,
        length: 0,
      },
      payload: pack_ip4_packet(packet),
    });

    return this.ip4.send(undefined, tun.remote_ip, IP_PROTOCOLS.UDP, inner);
  }
}
