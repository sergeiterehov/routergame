import { Port } from "../device";
import { System } from "../system";
import { OS } from "../os/os";
import { software } from "../apps";
import type { Bus } from "../bus";
import { SimpleEthernet, SimpleEthernetDriver } from "../simpleEthernet";
import { parseMAC } from "../format";

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

  const system = new System();

  if (config.ethernet) {
    let pid = 0;
    for (const { mac } of config.ethernet) {
      const dev = new SimpleEthernet(mac);
      system.addDevice(dev);
      expose(pid++, dev.port);
    }
  }

  const os = new OS(system);
  os.on_print = (text) => sendMessage({ $: "print", text });
  os.fs.on_change = (fs) => sendMessage({ $: "fs", fs });

  os.print(`Host ${self.name}\n`);
  os.install(software);

  const init_controller = new AbortController();

  onMessage((msg) => {
    if (msg.$ === "input") {
      os.on_input?.(msg.text);
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
      os.exec("init", [], { cwd: "/", signal: init_controller.signal }).catch((e) => {
        console.error(e);
        sendMessage({ $: "print", text: `[init error] ${e}\n` });
      });
    }
  });

  return os;
}
