import { SimpleEthernet, Port } from "./device";
import { System, BridgeDriver, SimpleEthernetDriver } from "./system";
import { OS } from "./os";

function expose(port: number, devicePort: Port) {
  devicePort.connect(({ tx }) => {
    const controller = new AbortController();

    self.addEventListener(
      "message",
      (e: MessageEvent<{ $: "ethernet_frame"; port: number; frame: Uint8Array }>) => {
        if (e.data.$ === "ethernet_frame") {
          if (e.data.port !== port) return;
          tx(e.data.frame);
        }
      },
      { signal: controller.signal },
    );

    return {
      rx: (frame) => {
        self.postMessage({ $: "ethernet_frame", port, frame });
      },
      link: (connected) => {
        if (!connected) controller.abort();
      },
    };
  });
}

const system = new System();
const dev0 = new SimpleEthernet(0xaa00n);
const dev1 = new SimpleEthernet(0xaa01n);
system.addDevice(dev0);
system.addDevice(dev1);

const os = new OS(system);
new BridgeDriver(os);
new SimpleEthernetDriver(os, 0);
new SimpleEthernetDriver(os, 1);

expose(0, dev0.port);
expose(1, dev1.port);

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
