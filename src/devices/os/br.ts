import type { TEthernetFrame } from "../pack";
import type { Net } from "./net";

const FDB_TTL = 60_000;

export type TBridgeFDB = { iBridge: number; mac: bigint; iPort: number; expiresAt: number };

export class Bridge {
  _fdb: TBridgeFDB[] = [];

  constructor(readonly net: Net) {
    setInterval(this._timer_handle_1s.bind(this), 1000);
  }

  _timer_handle_1s() {
    this.fdb_actualize();
  }

  fdb_update(iBridge: number, mac: bigint, iPort: number) {
    for (const _record of this._fdb) {
      if (_record.mac !== mac || _record.iBridge !== iBridge) continue;
      _record.mac = mac;
      _record.iPort = iPort;
      _record.expiresAt = Date.now() + FDB_TTL;
      return;
    }

    this._fdb.push({ iBridge, mac, iPort, expiresAt: Date.now() + FDB_TTL });
  }

  fdb_resolve(iBridge: number, mac: bigint) {
    for (const entry of this._fdb) {
      if (entry.mac !== mac || entry.iBridge !== iBridge) continue;
      return entry.iPort;
    }
    return -1;
  }

  send(iBridge: number, mac: bigint, frame: TEthernetFrame, iSourcePort: number = -1) {
    const iface_learned = this.net._interfaces[this.fdb_resolve(iBridge, mac)];

    if (iface_learned) {
      this.net.send_frame(iface_learned.index, frame);
    } else {
      // Broadcast
      for (const _iface_port of this.net._interfaces) {
        if (_iface_port.iMasterInterface !== iBridge) continue;
        if (_iface_port.index === iSourcePort) continue;
        this.net.send_frame(_iface_port.index, frame);
      }
    }
  }

  fdb_actualize() {
    const now = Date.now();

    for (let i = 0; i < this._fdb.length; i += 1) {
      if (this._fdb[i].expiresAt < now) {
        this._fdb.splice(i, 1);
        i -= 1;
      }
    }
  }
}
