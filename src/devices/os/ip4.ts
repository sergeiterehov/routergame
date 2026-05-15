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
import { Tracker, type TConnection } from "./tracker";
import { Firewall, FW_CHAINS } from "./fw";

export type TRoute = { network: number; prefix: number; gateway?: number; iInterface: number; src?: number };

export class IP4 {
  _forwarding = true;
  _default_ttl = 64;

  _queue: { iInterface: number; ip: number; frame: TEthernetFrame }[] = [];
  _routes: TRoute[] = [];
  _channel = new OSChannel<{ direction: "in" | "out"; iInterface: number; packet: TIP4Packet }>();

  readonly tracker = new Tracker(this);
  readonly fw = new Firewall(this);

  constructor(public readonly net: Net) {}

  handle_packet(iInterface: number, packet: TIP4Packet) {
    const conn = this.tracker.handle_packet(packet);

    if (!this.fw.handle_chain(FW_CHAINS.PRE_ROUTING, packet, { conn, inInterface: iInterface })) return;

    // TODO: dst-nat
    if (conn) {
      if (packet.header.dst === conn.reply_dst && conn.flags.src_nat) {
        packet.header.dst = conn.src;
      }
    }

    if (!this.fw.handle_chain(FW_CHAINS.DST_NAT, packet, { conn, inInterface: iInterface })) return;

    const { ttl, dst } = packet.header;

    let _input = false;
    if (dst === IP_BROADCAST) {
      _input = true;
    } else {
      for_interfaces: for (const _iface of this.net._interfaces) {
        for (const _ip of _iface.ips) {
          if (_ip.address === dst) {
            _input = true;
            break for_interfaces;
          }
        }
      }
    }

    // Input
    if (_input) {
      if (!this.fw.handle_chain(FW_CHAINS.INPUT, packet, { conn, inInterface: iInterface })) return;

      this.handle_protocol(iInterface, packet);
      return;
    }

    // Forwarding
    if (!this._forwarding) return;

    if (!this.fw.handle_chain(FW_CHAINS.FORWARD, packet, { conn, inInterface: iInterface })) return;

    if (ttl <= 1) return this.icmp_send_time_exceeded(iInterface, packet);

    const route = this.route(dst);
    if (!route) return;

    packet.header.ttl -= 1;

    this._send_packet(route.iInterface, route.gateway, packet, conn);
  }

  private _send_packet(iInterface: number, ip: number, packet: TIP4Packet, conn?: TConnection) {
    if (!this.fw.handle_chain(FW_CHAINS.POST_ROUTING, packet, { conn, outInterface: iInterface })) return;

    const route_iface = this.net._interfaces[iInterface];
    if (route_iface.mac === undefined) return;

    this._channel.postMessage({ direction: "out", iInterface, packet });

    let local_iface: TInterface | undefined;
    for (const _iface of this.net._interfaces) {
      for (const _ip of _iface.ips) {
        if (_ip.address !== ip) continue;
        local_iface = _iface;
        break;
      }
    }
    if (local_iface) {
      setTimeout(() => this.handle_packet(local_iface.index, packet));
      return;
    }

    conn ??= this.tracker.handle_packet(packet);

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

    if (!this.fw.handle_chain(FW_CHAINS.SRC_NAT, packet, { conn, outInterface: iInterface })) return;

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

  send_raw(dst_ip: number, packet: TIP4Packet) {
    const { src } = packet.header;

    if (!this.fw.handle_chain(FW_CHAINS.OUTPUT, packet, {})) return;

    const route = this.route(dst_ip);
    if (!route) return;

    if (src <= 0) packet.header.src = route.src;

    this._send_packet(route.iInterface, route.gateway, packet);
  }

  send(dst_ip: number, protocol: number, payload: Uint8Array, src_ip?: number) {
    const packet: TIP4Packet = {
      header: {
        version: 4,
        dst: dst_ip,
        src: src_ip ?? 0,
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

    this.send_raw(dst_ip, packet);
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

    this._send_packet(iInterface, route.gateway, response);
  }
}
