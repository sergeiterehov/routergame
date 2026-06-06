import type { Device } from "./device";
import type { OS } from "./os/os";

export class Hardware {
  _devices: Device[] = [];

  _interrupt?: (deviceIndex: number) => void;

  addDevice(device: Device) {
    const deviceIndex = this._devices.length;
    this._devices.push(device);
    device._interrupt = () => this._interrupt?.(deviceIndex);
    return deviceIndex;
  }
}
