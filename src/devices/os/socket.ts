import { IP_PROTOCOLS, pack_udp_packet, unpack_udp_packet, type TIP4Packet } from "../pack";
import type { Net, TInterface } from "./net";

export type TSocket = {
  ip: number;
} & (
  | { protocol: "raw"; on_data: (packet: TIP4Packet, ip: number, iface: TInterface) => void }
  | { protocol: "icmp"; on_data: (data: Uint8Array, ip: number, iface: TInterface) => void }
  | { protocol: "udp"; port: number; on_data: (data: Uint8Array, ip: number, port: number, iface: TInterface) => void }
);

export class Socket {
  _sockets: TSocket[] = [];

  constructor(public readonly net: Net) {}

  send_raw(socket: TSocket, packet: TIP4Packet) {
    if (socket.protocol !== "raw") return;

    const route = this.net.ip4.route(packet.header.dst);
    if (!route) return;

    return this.net.ip4.send_packet(route.iInterface, route.gateway, packet);
  }

  send_udp(socket: TSocket, data: Uint8Array, ip: number, port: number) {
    if (socket.protocol !== "udp") return;

    const payload = pack_udp_packet({ header: { dst: port, src: socket.port, length: 0, checksum: 0 }, payload: data });

    return this.net.ip4.send(ip, IP_PROTOCOLS.UDP, payload, -1);
  }

  handle_packet(iInterface: number, packet: TIP4Packet) {
    const iface = this.net._interfaces[iInterface];

    for (const socket of this._sockets) {
      if (socket.ip !== 0 && socket.ip !== packet.header.dst) continue;
      if (socket.protocol === "raw") {
        socket.on_data(packet, packet.header.src, iface);
      } else if (packet.header.protocol === IP_PROTOCOLS.ICMP && socket.protocol === "icmp") {
        socket.on_data(packet.payload, packet.header.src, iface);
      } else if (socket.protocol === "udp" && packet.header.protocol === IP_PROTOCOLS.UDP) {
        const udp_struct = unpack_udp_packet(packet.payload);
        if (socket.port === udp_struct.header.dst) {
          socket.on_data(udp_struct.payload, packet.header.src, udp_struct.header.src, iface);
        }
      }
    }
  }
}
