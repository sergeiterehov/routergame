import { MAC_BROADCAST, type TEthernetFrame } from "../pack";
import type { Net, TInterface } from "./net";

const _FDB_TTL = 60_000;

export type TBridge = { iBridge: number; ports: TBridgePort[]; vlan_filtering: boolean; pvid: number };
export type TBridgePort = { iPort: number; pvid: number; untagged: number[]; tagged: number[] };
export type TBridgeFDB = { iBridge: number; mac: bigint; vid?: number; iPort: number; expiresAt: number };

export class Bridge {
  _default_pvid = 1;

  _bridges: TBridge[] = [];

  _fdb: TBridgeFDB[] = [];

  constructor(readonly net: Net) {
    setInterval(this._timer_handle_1s.bind(this), 1000);
  }

  private _timer_handle_1s() {
    this._fdb_actualize();
  }

  send_frame(iBridge: number, mac: bigint, frame: TEthernetFrame, iSourcePort?: number) {
    const bridge = this.get_bridge(iBridge);

    if (bridge.vlan_filtering) {
      if (!frame.tag) {
        frame.tag = {
          dei: 0,
          pcp: 0,
          vid: bridge.pvid,
        };
      }
    }

    const iLearnedPort = this._fdb_resolve(iBridge, mac, bridge.vlan_filtering ? bridge.pvid : undefined);
    if (iLearnedPort !== undefined) {
      return this._send_frame_to_port(iBridge, iLearnedPort, frame);
    }

    const ports = bridge.ports;
    if (!ports) return;

    for (const port of ports) {
      if (port.iPort === iSourcePort) continue;

      this._send_frame_to_port(iBridge, port.iPort, frame);
    }
  }

  private _send_frame_to_port(iBridge: number, iPort: number, frame: TEthernetFrame) {
    const bridge = this.get_bridge(iBridge);

    if (bridge.vlan_filtering) {
      const port = this.get_port(iPort);

      if (frame.tag) {
        if (frame.tag.vid !== port.pvid) return;

        if (port.tagged.includes(frame.tag.vid)) {
          // keep tag
        } else if (port.untagged.includes(frame.tag.vid)) {
          delete frame.tag;
        } else {
          return;
        }
      }
    }

    this.net.send_frame(iPort, frame);
  }

  handle_port_frame(br: TInterface, iPort: number, frame: TEthernetFrame) {
    const bridge = this.get_bridge(br.index);

    if (bridge.vlan_filtering) {
      const port = this.get_port(iPort);

      if (!frame.tag) {
        frame.tag = {
          dei: 0,
          pcp: 0,
          vid: port.pvid,
        };
      }

      if (!port.untagged.includes(frame.tag.vid) && !port.tagged.includes(frame.tag.vid)) {
        return;
      }
    }

    const { dst, src } = frame;

    this._fdb_update(br.index, src, iPort, bridge.vlan_filtering ? frame.tag!.vid : undefined);

    // to port
    const port_iface = this.net.iface(iPort);
    if (dst === port_iface.mac) {
      this.net.handle_frame(br.index, frame);
      return;
    }

    // broadcast
    if (dst === MAC_BROADCAST) {
      this.net.handle_frame(br.index, frame);
    }

    this.send_frame(br.index, dst, frame, iPort);
  }

  get_bridge(iBridge: number) {
    for (const _bridge of this._bridges) {
      if (_bridge.iBridge === iBridge) return _bridge;
    }
    throw new Error("Bridge not found");
  }

  get_port(iPort: number) {
    for (const _bridge of this._bridges) {
      for (const _port of _bridge.ports) {
        if (_port.iPort === iPort) {
          return _port;
        }
      }
    }
    throw new Error("Port not found");
  }

  private _fdb_update(iBridge: number, mac: bigint, iPort: number, vid?: number) {
    for (const _rec of this._fdb) {
      if (_rec.mac !== mac || _rec.iBridge !== iBridge || _rec.vid !== vid) continue;
      _rec.mac = mac;
      _rec.iPort = iPort;
      _rec.expiresAt = Date.now() + _FDB_TTL;
      return;
    }

    this._fdb.push({ iBridge, mac, vid, iPort, expiresAt: Date.now() + _FDB_TTL });
  }

  private _fdb_resolve(iBridge: number, mac: bigint, vid?: number) {
    for (const _rec of this._fdb) {
      if (_rec.mac !== mac || _rec.iBridge !== iBridge || _rec.vid !== vid) continue;
      return _rec.iPort;
    }
  }

  private _fdb_actualize() {
    const now = Date.now();

    for (let i = 0; i < this._fdb.length; i += 1) {
      if (this._fdb[i].expiresAt < now) {
        this._fdb.splice(i, 1);
        i -= 1;
      }
    }
  }
}
