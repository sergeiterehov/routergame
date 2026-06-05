import { software } from "../core/apps";
import type { Bus } from "./bus";
import type { Port } from "../core/device";
import { parseMAC } from "../core/format";
import { Hardware } from "../core/hardware";
import { OS } from "../core/os/os";
import { SimpleEthernet, SimpleEthernetDriver } from "../core/store/simpleEthernet.device";

export function onMessage(handler: (message: Bus.Message.Master) => void, options: AddEventListenerOptions = {}) {
  self.addEventListener("message", (e: MessageEvent<Bus.Message.Master>) => handler(e.data), options);
}

export function sendMessage(message: Bus.Message.Slave) {
  self.postMessage(message);
}

export function expose(port: number, devicePort: Port) {
  devicePort.connect(({ tx }) => {
    const controller = new AbortController();

    onMessage(
      (msg) => {
        if (msg.$ === "ethernet_frame") {
          if (msg.port !== port) return;
          tx(msg.frame);
        }
      },
      { signal: controller.signal },
    );

    return {
      rx: (frame) => {
        sendMessage({ $: "ethernet_frame", port, frame });
      },
      link: (connected) => {
        if (!connected) controller.abort();
      },
    };
  });
}

export function beginWorkerOS(config: { type: string; ethernet?: { mac: bigint }[] } = { type: "unknown" }) {
  console.log("Hello", config.type, self.name);

  const system = new Hardware();

  if (config.ethernet) {
    let pid = 0;
    for (const { mac } of config.ethernet) {
      const dev = new SimpleEthernet(mac);
      system.addDevice(dev);
      expose(pid++, dev.port);
    }
  }

  const os = new OS(system);
  os._hostname = self.name;
  os.on_output = (text) => sendMessage({ $: "print", text });
  os.fs.on_change = (fs) => sendMessage({ $: "fs", fs });
  {
    const lo = os.net.add_interface("loopback", "lo", -1);
    lo.flags.UP = true;
    lo.ips.push({ address: (127 << 24) + 1, prefix: 8 });
    os.net.ip4._routes.push({ iInterface: lo.index, network: 127 << 24, prefix: 8 });
  }
  os.install(software);

  onMessage((msg) => {
    if (msg.$ === "input") {
      os.input(msg.text);
    } else if (msg.$ === "fs") {
      for (const [key, value] of Object.entries(msg.fs)) {
        if (typeof value === "string") {
          os.fs._fs[key] = value;
        } else {
          delete os.fs._fs[key];
        }
      }
    } else if (msg.$ === "configure") {
      const { hw_address } = msg;

      if (hw_address) {
        for (const hw of hw_address) {
          const dev = system._devices[hw.port];

          if (dev instanceof SimpleEthernet) {
            dev.mac = parseMAC(hw.mac);
            new SimpleEthernetDriver(os, hw.port);
          } else {
            console.error(`Device ${hw.port} is not SimpleEthernet`);
          }
        }
      }
    } else if (msg.$ === "init") {
      os.exec("init", [], os._root_app_ctx).catch((e) => {
        console.error(e);
        sendMessage({ $: "print", text: `[init error] ${e}\n` });
      });
    }
  });

  return os;
}
