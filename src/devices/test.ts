import { SimpleEthernet, UTPEthernetFrames, Device } from "./device";
import { formatMAC, formatIPv4, hexdump, parseIPv4 } from "./format";
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

const wire0 = new UTPEthernetFrames();
const ext0 = new Device();
wire0.connect(ext0, (frame) => console.log("-> EXT_0", hexdump(frame)));
dev0.connect(wire0);

const wire1 = new UTPEthernetFrames();
const ext1 = new Device();
wire1.connect(ext1, (frame) => console.log("-> EXT_1", hexdump(frame)));
dev1.connect(wire1);

// interfaces
{
  os._netInterfaces.find((p) => p.name === "eth0")!.ips = [
    { address: 0x0a000002, prefix: 24 },
    { address: 0x0a000003, prefix: 24 },
  ];
  os._netInterfaces.find((p) => p.name === "eth1")!.ips = [{ address: 0xc0a80002, prefix: 24 }];

  os._netRoutes.push({
    network: 0x0a000000,
    prefix: 24,
    iInterface: os._netInterfaces.findIndex((p) => p.name === "eth0"),
  });
  os._netRoutes.push({
    network: 0xc0a80000,
    prefix: 24,
    iInterface: os._netInterfaces.findIndex((p) => p.name === "eth1"),
  });
  os._netRoutes.push({
    network: 0,
    prefix: 0,
    gateway: 0xc0a80001,
    iInterface: os._netInterfaces.findIndex((p) => p.name === "eth1"),
  });

  // br0
  {
    const iface = os._netInterfaces[os.net_add_interface("br0", 0)];
    iface.isBridge = true;
    // os._netInterfaces.find((p) => p.name === "eth0")!.iMasterInterface = os._netInterfaces.indexOf(iface);
    // os._netInterfaces.find((p) => p.name === "eth1")!.iMasterInterface = os._netInterfaces.indexOf(iface);
  }
}

// ifconfig
{
  for (let i = 0; i < os._netInterfaces.length; i++) {
    const iface = os._netInterfaces[i];
    console.log(
      [
        `${iface.name}: <${[iface.isBridge && "BRIDGE", iface.iMasterInterface ? "SLAVE" : undefined].filter(Boolean).join(",")}>`,
        iface.mac && `ether ${formatMAC(iface.mac)}`,
        iface.ips?.map((ip) => `inet ${formatIPv4(ip.address)}/${ip.prefix}`).join("\n\t"),
        ...os._netInterfaces.filter((other) => other.iMasterInterface === i).map((other) => `member: ${other.name}`),
      ]
        .filter(Boolean)
        .join("\n\t"),
    );
  }
}

// routes
{
  for (let i = 0; i < os._netRoutes.length; i++) {
    const route = os._netRoutes[i];
    const iface = os._netInterfaces[route.iInterface];
    console.log(
      [
        "route:",
        `${formatIPv4(route.network)}/${route.prefix} via dev ${iface.name}`,
        route.gateway !== undefined && `default ${formatIPv4(route.gateway)}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

// console.log("FROM OS");
// os.net_send_frame(0, new Uint8Array([0x00, 0xbb, 0xcc, 0xdd, 0xee, 0xff]));

console.log("FROM EXT_0");
wire1.send(
  ext1,
  new Uint8Array([
    // dst
    0, 0, 0, 0, 0xaa, 0x01,
    // src
    0, 0, 0, 0, 0xbb, 0x00,
    // ether type
    0x08, 0x00,
    // ipv4
    0x45, 0, 0, 0, 0x12, 0x34, 0, 0, 0x40, 0x11, 0, 0,
    // src
    8, 8, 8, 8,
    // dst
    192, 168, 0, 5,
  ]),
);

// Arp response
{
  const frame = new Uint8Array(6 + 6 + 2 + 28);
  const view = new DataView(frame.buffer);
  view.setBigUint64(0, dev1.mac << 16n);
  view.setBigUint64(6, 0xaabbccddeeffn << 16n);
  view.setUint16(12, 0x0806);
  view.setUint16(14, 0x0001);
  view.setUint16(16, 0x0800);
  view.setUint8(18, 0x06);
  view.setUint8(19, 0x04);
  view.setUint16(20, 0x0002);
  view.setBigUint64(22, 0xff00ff00ff00n << 16n);
  view.setUint32(28, parseIPv4("192.168.0.5"));
  view.setBigUint64(32, dev0.mac);
  view.setUint32(38, parseIPv4("192.168.0.2"));

  wire1.send(ext1, frame);
}

// Arp Request
{
  console.log("ARP REQUEST");

  const frame = new Uint8Array(6 + 6 + 2 + 28);
  const view = new DataView(frame.buffer);
  view.setBigUint64(0, dev1.mac << 16n);
  view.setBigUint64(6, 0xaabbccddeeffn << 16n);
  view.setUint16(12, 0x0806);
  view.setUint16(14, 0x0001);
  view.setUint16(16, 0x0800);
  view.setUint8(18, 0x06);
  view.setUint8(19, 0x04);
  view.setUint16(20, 0x0001);
  view.setBigUint64(22, 0xff00ff00ff00n << 16n);
  view.setUint32(28, parseIPv4("192.168.0.5"));
  view.setBigUint64(32, 0x00n);
  view.setUint32(38, parseIPv4("192.168.0.2"));

  wire1.send(ext1, frame);
}
