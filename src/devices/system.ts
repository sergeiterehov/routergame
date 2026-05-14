import type { Device } from "./device";
import type { OS } from "./os/os";

export class System {
  _devices: Device[] = [];

  _interrupt?: (deviceIndex: number) => void;

  addDevice(device: Device) {
    const deviceIndex = this._devices.length;
    this._devices.push(device);
    device._interrupt = () => this._interrupt?.(deviceIndex);
    return this;
  }
}

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
