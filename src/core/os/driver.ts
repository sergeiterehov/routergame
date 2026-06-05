import type { OS } from "./os";

export class Driver {
  name: string = "";
  instance: string = "";

  _os: OS;
  _iDriver: number = -1;

  net_send_frame?: (iInterface: number, data: Uint8Array) => void;

  constructor(os: OS) {
    this._os = os;
    this._iDriver = this._os._drivers.length;
    this._os._drivers.push(this);
  }

  call(cmd: unknown) {}
}
