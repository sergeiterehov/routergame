import { SimpleEthernet, UTPEthernetFrames, Device } from "./device";
import { System, BridgeDriver, SimpleEthernetDriver } from "./system";
import { OS } from "./os";

const system = new System();
const dev0 = new SimpleEthernet(0xaa00n);
const dev1 = new SimpleEthernet(0xaa01n);
system.addDevice(dev0);
system.addDevice(dev1);

const os = new OS(system);
new BridgeDriver(os);
new SimpleEthernetDriver(os, 0);
new SimpleEthernetDriver(os, 1);

class WorkerDevice extends Device {
  _port: number;
  _utp?: UTPEthernetFrames;

  constructor(port: number) {
    super();
    this._port = port;

    self.addEventListener("message", this._handle_message.bind(this));
  }

  connect(utp: UTPEthernetFrames) {
    utp.connect(this, this._handle_frame.bind(this));
    this._utp = utp;
  }

  _handle_frame(frame: Uint8Array) {
    self.postMessage({ $: "ethernet_frame", port: this._port, frame });
  }

  _handle_message(e: MessageEvent<{ $: "ethernet_frame"; port: number; frame: Uint8Array }>) {
    if (e.data.$ === "ethernet_frame") {
      if (e.data.port !== this._port) return;
      this._utp?.send(this, e.data.frame);
    }
  }
}

const wire0 = new UTPEthernetFrames();
const ext0 = new WorkerDevice(0);
dev0.connect(wire0);
ext0.connect(wire0);

const wire1 = new UTPEthernetFrames();
const ext1 = new WorkerDevice(1);
dev1.connect(wire1);
ext1.connect(wire1);

// interfaces
{
  function get_iface(name: string) {
    return os._netInterfaces.find((p) => p.name === name);
  }
  function get_iface_index(name: string) {
    return os._netInterfaces.findIndex((p) => p.name === name);
  }

  get_iface("eth0")!.ips = [
    { address: 0x0a000002, prefix: 24 },
    { address: 0x0a000003, prefix: 24 },
  ];
  get_iface("eth1")!.ips = [{ address: 0xc0a80002, prefix: 24 }];

  os._netRoutes.push({
    network: 0x0a000000,
    prefix: 24,
    iInterface: get_iface_index("eth0"),
  });
  os._netRoutes.push({
    network: 0xc0a80000,
    prefix: 24,
    iInterface: get_iface_index("eth1"),
  });
  os._netRoutes.push({
    network: 0,
    prefix: 0,
    gateway: 0xc0a80001,
    iInterface: get_iface_index("eth1"),
  });
}
