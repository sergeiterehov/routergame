import { IP_PROTOCOLS, pack_udp_packet, unpack_ip4_packet, unpack_udp_packet } from "../pack";
import type { Net, TInterface } from "./net";

export type TSocket = {
  ip: number;
} & (
  | { protocol: "raw"; on_data: (data: Uint8Array, ip: number, iface: TInterface) => void }
  | { protocol: "icmp"; on_data: (data: Uint8Array, ip: number, iface: TInterface) => void }
  | { protocol: "udp"; port: number; on_data: (data: Uint8Array, ip: number, port: number, iface: TInterface) => void }
);

export class Socket {
  _sockets: TSocket[] = [];

  constructor(public readonly net: Net) {}

  send_raw(socket: TSocket, data: Uint8Array) {
    if (socket.protocol !== "raw") return;

    const struct = unpack_ip4_packet(data);

    const route = this.net.ip4.route(struct.header.dst);
    if (!route) return;

    return this.net.ip4.send_packet(route.iInterface, route.gateway, data);
  }

  send_udp(socket: TSocket, data: Uint8Array, ip: number, port: number) {
    if (socket.protocol !== "udp") return;

    const payload = pack_udp_packet({ header: { dst: port, src: socket.port, length: 0, checksum: 0 }, payload: data });

    return this.net.ip4.send(ip, IP_PROTOCOLS.UDP, payload, -1);
  }

  handle_packet(iInterface: number, packet: Uint8Array) {
    const iface = this.net._interfaces[iInterface];
    const ip_struct = unpack_ip4_packet(packet);

    for (const socket of this._sockets) {
      if (socket.ip !== 0 && socket.ip !== ip_struct.header.dst) continue;
      if (socket.protocol === "raw") {
        socket.on_data(packet, ip_struct.header.src, iface);
      } else if (ip_struct.header.protocol === IP_PROTOCOLS.ICMP && socket.protocol === "icmp") {
        socket.on_data(ip_struct.payload, ip_struct.header.src, iface);
      } else if (socket.protocol === "udp" && ip_struct.header.protocol === IP_PROTOCOLS.UDP) {
        const udp_struct = unpack_udp_packet(ip_struct.payload);
        if (socket.port === udp_struct.header.dst) {
          socket.on_data(udp_struct.payload, ip_struct.header.src, udp_struct.header.src, iface);
        }
      }
    }
  }
}
