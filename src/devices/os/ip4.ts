import type { Net, TInterface } from "./net";
import {
  ETHER_TYPES,
  IP_BROADCAST,
  IP_PROTOCOLS,
  pack_icmp_packet,
  pack_ip4_packet,
  unpack_icmp_packet,
  type TEthernetFrame,
  type TIP4Packet,
} from "../pack";
import { OSChannel } from "./os";
import { testSameNetwork } from "../format";
import { Tracker } from "./tracker";

export type TRoute = { network: number; prefix: number; gateway?: number; iInterface: number; src?: number };

export class IP4 {
  _forwarding = true;
  _default_ttl = 64;

  _queue: { iInterface: number; ip: number; frame: TEthernetFrame }[] = [];
  _routes: TRoute[] = [];
  _channel = new OSChannel<{ direction: "in" | "out"; iInterface: number; packet: TIP4Packet }>();

  readonly tracker = new Tracker(this);

  constructor(public readonly net: Net) {}

  handle_packet(iInterface: number, packet: TIP4Packet) {
    this.tracker.handle_packet(packet);

    const { ttl, dst } = packet.header;

    if (dst === IP_BROADCAST) return this.handle_protocol(iInterface, packet);

    // Own IP
    for (const _iface of this.net._interfaces) {
      for (const _ip of _iface.ips) {
        if (_ip.address === dst) {
          return this.handle_protocol(iInterface, packet);
        }
      }
    }

    // Forwarding
    if (!this._forwarding) return;

    if (ttl <= 1) return this.icmp_send_time_exceeded(iInterface, packet);

    const route = this.route(dst);
    if (!route) return;

    packet.header.ttl -= 1;

    this.send_packet(route.iInterface, route.gateway, packet);
  }

  handle_protocol(iInterface: number, packet: TIP4Packet) {
    this._channel.postMessage({ direction: "in", iInterface, packet });

    // icmp
    if (packet.header.protocol === IP_PROTOCOLS.ICMP) {
      this.icmp_handle(iInterface, packet);
    }

    this.net.socket.handle_packet(iInterface, packet);
  }

  icmp_handle(iInterface: number, packet: TIP4Packet) {
    const icmp = unpack_icmp_packet(packet.payload);

    // TODO: types 0,3,8

    if (icmp.type === 8) {
      const reply = pack_icmp_packet({
        type: 0,
        code: 0,
        checksum: 0,
        data: icmp.data,
        payload: icmp.payload,
      });

      this.send(packet.header.src, IP_PROTOCOLS.ICMP, reply, packet.header.dst);
    }
  }

  send_packet(iInterface: number, ip: number, packet: TIP4Packet) {
    const route_iface = this.net._interfaces[iInterface];
    if (route_iface.mac === undefined) return;

    this._channel.postMessage({ direction: "out", iInterface, packet });

    let local_iface: TInterface | undefined;

    for (const _iface of this.net._interfaces) {
      for (const _ip of _iface.ips) {
        if (_ip.address === ip) {
          local_iface = _iface;
          break;
        }
      }
    }

    if (local_iface) {
      setTimeout(() => this.handle_packet(local_iface.index, packet));
      return;
    }

    const src_mac = route_iface.mac;
    let dst_mac = -1n; // -1 unknown, -2 pending, -3 fail

    for (const _arp of this.net.arp._table) {
      if (_arp.iInterface === iInterface && _arp.ip === ip) {
        switch (_arp.state) {
          case "success": {
            dst_mac = _arp.mac;
            break;
          }
          case "pending": {
            dst_mac = -2n;
            break;
          }
          case "fail": {
            dst_mac = -3n;
            break;
          }
        }
        break;
      }
    }

    if (dst_mac === -3n) return;

    const frame: TEthernetFrame = {
      dst: dst_mac,
      src: src_mac,
      etherType: ETHER_TYPES.IPv4,
      payload: pack_ip4_packet(packet),
    };

    if (dst_mac < 0n) {
      this._queue.push({ iInterface, ip, frame });
      if (dst_mac === -1n) this.net.arp.send_request(iInterface, ip);
    } else {
      this.net.send_frame(iInterface, frame);
    }
  }

  send(ip: number, protocol: number, payload: Uint8Array, src_ip: number) {
    const route = this.route(ip);
    if (!route) return;

    const packet: TIP4Packet = {
      header: {
        version: 4,
        dst: ip,
        src: src_ip >= 0 ? src_ip : route.src,
        protocol,
        ttl: this._default_ttl,
        flags: 0,
        id: 0,
        ihl: 0,
        length: 0,
        offset: 0,
        options: [],
        tos: 0,
        checksum: 0,
      },
      payload,
    };

    this.send_packet(route.iInterface, route.gateway, packet);
  }

  route(dst: number) {
    let route: TRoute | undefined;
    for (const _route of this._routes) {
      if (!testSameNetwork(dst, _route.network, _route.prefix)) continue;
      if (!route || _route.prefix > route.prefix) {
        route = _route;
        break;
      }
    }
    if (!route) return;

    const iface = this.net._interfaces[route.iInterface];

    let src = -1;
    if (route.src) {
      src = route.src;
    } else if (iface.ips.length) {
      src = iface.ips[0].address;
    } else {
      return;
    }

    return { ...route, gateway: route.gateway ?? dst, src };
  }

  process_queue(iInterface: number, ip: number) {
    for (let i = 0; i < this._queue.length; i++) {
      const record = this._queue[i];
      if (record.iInterface === iInterface && record.ip === ip) {
        const dst_mac = this.net.arp.resolve(iInterface, ip);
        if (dst_mac < 0n) continue;

        const { frame } = record;
        frame.dst = dst_mac;

        this.net.send_frame(record.iInterface, frame);
      }
    }
  }

  icmp_send_time_exceeded(iInterface: number, packet: TIP4Packet) {
    const { src } = packet.header;

    const route = this.route(src);
    if (!route) return;

    const response: TIP4Packet = {
      header: {
        version: 4,
        dst: src,
        src: route.src,
        protocol: 1,
        ttl: this._default_ttl,
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
        type: 11,
        code: 0,
        checksum: 0,
        data: new Uint8Array(4),
        payload: pack_ip4_packet({ ...packet, payload: new Uint8Array() }),
      }),
    };

    this.send_packet(iInterface, route.gateway, response);
  }
}
