import { SimpleEthernet, Port } from "./device";
import { System, BridgeDriver, SimpleEthernetDriver } from "./system";
import { OS } from "./os";
import * as ifconfig from "./apps/ifconfig.app";

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
os.on_print = (text) => self.postMessage({ $: "print", text });

new BridgeDriver(os);
new SimpleEthernetDriver(os, 0);
new SimpleEthernetDriver(os, 1);

expose(0, dev0.port);
expose(1, dev1.port);

os.install(ifconfig);

os.exec("iface", ["eth0", "add", "10.0.0.2/24"]);
os.exec("iface", ["eth0", "add", "10.0.0.3/24"]);
os.exec("iface", ["eth1", "add", "192.168.0.2/24"]);

os.exec("route", ["add", "10.0.0.0/24", "dev", "eth0"]);
os.exec("route", ["add", "192.168.0.0/24", "dev", "eth1"]);
os.exec("route", ["add", "default", "via", "192.168.0.1", "dev", "eth1"]);

self.addEventListener("message", (e: MessageEvent<{ $: "exec"; app: string; args: string[] }>) => {
  if (e.data.$ === "exec") {
    os.exec(e.data.app, e.data.args);
  }
});
