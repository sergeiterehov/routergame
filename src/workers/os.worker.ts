import { software } from "../core/apps";
import { parseMAC } from "../core/format";
import { Hardware } from "../core/hardware";
import { INTERFACE_TYPES } from "../core/os/net";
import { OS } from "../core/os/os";
import { SimpleEthernet, SimpleEthernetDriver } from "../core/store/simpleEthernet.device";
import { sendMessage, onMessage, expose } from "./helpers";

function begin() {
  console.log("Hello", self.name);

  const system = new Hardware();

  const os = new OS(system);
  os._hostname = self.name;
  os.on_output = (text) => sendMessage({ $: "print", text });
  os.fs.on_change = (fs) => sendMessage({ $: "fs", fs });
  {
    const lo = os.net.add_interface(INTERFACE_TYPES.LOOPBACK, "lo", -1);
    lo.max_mtu = 65535;
    lo.mtu = 65535;
    lo.flags.UP = true;
    lo.flags.LOOPBACK = true;
    lo.flags.RUNNING = true;
    lo.ips.push({ ip: (127 << 24) + 1, prefix: 8 });
    os.net.ip4._routes.push({ iInterface: lo.index, network: 127 << 24, prefix: 8 });
  }
  os.install(software);

  let _hw_configured = false;

  onMessage((msg) => {
    if (msg.$ === "input") {
      os.input(msg.text);
    } else if (msg.$ === "fs") {
      for (const [key, value] of Object.entries(msg.fs)) {
        if (typeof value === "string") {
          os.fs.write(key, value);
        } else {
          os.fs.rm(key);
        }
      }
    } else if (msg.$ === "configure") {
      const { hw_address } = msg;

      if (hw_address) {
        if (_hw_configured) console.error("Hardware already configured");
        _hw_configured = true;

        for (const hw of hw_address) {
          const dev = new SimpleEthernet(parseMAC(hw.mac));
          const iDevice = system.addDevice(dev);
          new SimpleEthernetDriver(os, iDevice);
          expose(hw.port, dev.port);
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

begin();
