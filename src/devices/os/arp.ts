import {
  ARP_OPCODES,
  ETHER_TYPES,
  MAC_BROADCAST,
  pack_arp_packet,
  unpack_arp_packet,
  type TEthernetFrame,
} from "../pack";
import type { Net } from "./net";
import { OSChannel } from "./os";

const ARP_TIMEOUT_MS = 3_000;
const ARP_TTL_MS = 60_000;
const ARP_RETRY_MS = 5_000;

export type TArpRecord = {
  iInterface: number;
  ip: number;
  mac: bigint;
  expiresAt: number;
  state: "pending" | "success" | "fail";
};

export class ARP {
  _table: TArpRecord[] = [];

  _channel = new OSChannel<"pending" | "fail" | "success" | "retry">();

  constructor(public readonly net: Net) {
    setInterval(this._timer_handle_1s.bind(this), 1000);
  }

  _timer_handle_1s() {
    this.actualize();
  }

  send_request(iInterface: number, ip: number) {
    const iface = this.net._interfaces[iInterface];
    const src_mac = iface.mac;
    if (!src_mac) return;

    const sender_ip = iface.ips[0];
    if (!sender_ip) return;

    const frame: TEthernetFrame = {
      dst: MAC_BROADCAST,
      src: src_mac,
      etherType: ETHER_TYPES.ARP,
      payload: pack_arp_packet({
        hwType: 0x0001,
        protoType: ETHER_TYPES.IPv4,
        hwSize: 6,
        protoSize: 4,
        opcode: ARP_OPCODES.REQUEST,
        src_mac,
        src_ip: sender_ip.address,
        dst_ip: ip,
        dst_mac: 0n,
      }),
    };

    this.net.send_frame(iInterface, frame);

    this._table.push({
      iInterface,
      ip,
      mac: 0n,
      state: "pending",
      expiresAt: Date.now() + ARP_TIMEOUT_MS,
    });

    this._channel.postMessage("pending");
  }

  update(iInterface: number, ip: number, mac: bigint) {
    for (const entry of this._table) {
      if (entry.iInterface === iInterface && entry.ip === ip) {
        entry.mac = mac;
        entry.state = "success";
        entry.expiresAt = Date.now() + ARP_TTL_MS;
        return;
      }
    }

    this._table.push({
      iInterface,
      mac,
      ip,
      state: "success",
      expiresAt: Date.now() + ARP_TTL_MS,
    });
  }

  handle(iInterface: number, frame: TEthernetFrame) {
    const iface = this.net._interfaces[iInterface];
    if (!iface.mac) return;

    const arp = unpack_arp_packet(frame.payload);
    const { opcode, src_mac, src_ip, dst_ip } = arp;

    if (opcode === ARP_OPCODES.REQUEST) {
      // Request
      for (const _iface of this.net._interfaces) {
        for (const _ip of _iface.ips) {
          if (_ip.address === dst_ip) {
            const frame: TEthernetFrame = {
              dst: src_mac,
              src: iface.mac,
              etherType: ETHER_TYPES.ARP,
              payload: pack_arp_packet({
                hwType: ARP_OPCODES.REPLY,
                protoType: ETHER_TYPES.IPv4,
                hwSize: 6,
                protoSize: 4,
                opcode: ARP_OPCODES.REPLY,
                src_mac: iface.mac,
                src_ip: _ip.address,
                dst_mac: src_mac,
                dst_ip: src_ip,
              }),
            };

            this.net.send_frame(iInterface, frame);

            return;
          }
        }
      }
    } else if (opcode === ARP_OPCODES.REPLY) {
      // Reply
      let arp: TArpRecord | undefined;
      for (const _arp of this._table) {
        if (_arp.iInterface === iInterface && _arp.ip === src_ip) {
          arp = _arp;
          break;
        }
      }
      if (!arp) return;

      arp.state = "success";
      arp.mac = src_mac;
      arp.expiresAt = Date.now() + ARP_TTL_MS;

      this._channel.postMessage("success");

      this.net.ip4.process_queue(iInterface, src_ip);
    }
  }

  resolve(iInterface: number, ip: number) {
    for (const _entry of this._table) {
      if (_entry.iInterface === iInterface && _entry.ip === ip) {
        if (_entry.state === "success") {
          return _entry.mac;
        }
      }
    }

    return -1n;
  }

  actualize() {
    const now = Date.now();
    let failed = 0;
    let removed = 0;

    for (let i = 0; i < this._table.length; i++) {
      const arp = this._table[i];
      if (arp.expiresAt < now) {
        if (arp.state === "pending") {
          arp.state = "fail";
          arp.expiresAt = now + ARP_RETRY_MS;
          failed += 1;
        } else {
          this._table.splice(i, 1);
          removed += 1;
          i--;
        }
        continue;
      }
    }

    if (failed) this._channel.postMessage("fail");
    if (removed) this._channel.postMessage("retry");
  }
}
