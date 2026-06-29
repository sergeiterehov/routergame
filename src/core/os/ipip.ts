import { IP_PROTOCOLS, pack_ip4_packet, unpack_ip4_packet, type TIP4Packet } from "../pack";
import type { IP4 } from "./ip4";
import { E_NET } from "./net";

export type TIPIPTun = {
  iInterface: number;
  local_ip: number;
  remote_ip: number;
};

export class IPIP {
  _tuns: TIPIPTun[] = [];

  constructor(readonly ip4: IP4) {}

  handle_packet(iOuterInterface: number, packet: TIP4Packet) {
    for (const tun of this._tuns) {
      if (tun.local_ip === packet.header.dst && tun.remote_ip === packet.header.src) {
        const inner = unpack_ip4_packet(packet.payload);
        this.ip4.handle_packet(tun.iInterface, inner);
        return;
      }
    }
  }

  send_packet(iInnerInterface: number, packet: TIP4Packet): number {
    const tun = this._tuns.find((tun) => tun.iInterface === iInnerInterface);
    if (!tun) return E_NET.NO_ROUTE;

    const inner = pack_ip4_packet(packet);
    return this.ip4.send(undefined, tun.remote_ip, IP_PROTOCOLS.IPIP, inner);
  }
}
