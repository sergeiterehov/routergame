import type { Device, SimpleEthernet } from "./device";
import type { OS } from "./os";

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

export class SimpleEthernetDriver extends Driver {
  name = "SimpleEthernet";

  _device: SimpleEthernet;
  _iInterface: number = -1;

  constructor(os: OS, iDevice: number) {
    super(os);

    const device = this._os._system._devices[iDevice];
    if (!device) throw new Error("Device not found");
    if (device.type !== "SimpleEthernet") throw new Error("Device is not SimpleEthernet");
    this._device = device as SimpleEthernet;

    this._os.interrupt_register(iDevice, this._handleInterrupt.bind(this));

    this.instance = `SimpleEthernet:${this._device.gid}`;

    this._iInterface = this._os.net_add_interface("ethernet", `eth${iDevice}`, this._iDriver);
    const iface = this._os._netInterfaces[this._iInterface];
    iface.mac = this._device.mac;
    iface.flags.LOWER_UP = this._device.get_link();
    iface.flags.UP = true;
  }

  _handleInterrupt() {
    const dev = this._device;

    if (dev.received) {
      this._os.net_handle_frame(this._iInterface, dev.received);
      dev.received = undefined;
    }

    const iface = this._os._netInterfaces[this._iInterface];
    iface.flags.LOWER_UP = dev.get_link();
  }

  net_send_frame = (iInterface: number, data: Uint8Array) => {
    this._device.tx(data);
  };

  call(cmd: { $: "change_mac"; mac: bigint }) {
    if (cmd.$ === "change_mac") {
      this._device.change_mac(cmd.mac);
      this._os._netInterfaces[this._iInterface].mac = cmd.mac;
    }
  }
}
