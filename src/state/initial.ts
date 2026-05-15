import type { TArchitecture } from "./store";

export const initial_arch: TArchitecture = {
  title: "Test",
  node: [
    {
      id: "router",
      type: "router",
      name: "Router",
      ports: [
        { id: "eth0", type: "ethernet" },
        { id: "eth1", type: "ethernet" },
        { id: "eth2", type: "ethernet" },
        { id: "eth3", type: "ethernet" },
        { id: "eth4", type: "ethernet" },
        { id: "eth5", type: "ethernet" },
        { id: "eth6", type: "ethernet" },
        { id: "eth7", type: "ethernet" },
      ],
      ethernetPorts: [
        { id: "eth0", mac: "00:00:00:ff:00:00" },
        { id: "eth1", mac: "00:00:00:ff:00:01" },
        { id: "eth2", mac: "00:00:00:ff:00:02" },
        { id: "eth3", mac: "00:00:00:ff:00:03" },
        { id: "eth4", mac: "00:00:00:ff:00:04" },
        { id: "eth5", mac: "00:00:00:ff:00:05" },
        { id: "eth6", mac: "00:00:00:ff:00:06" },
        { id: "eth7", mac: "00:00:00:ff:00:07" },
      ],
      fs: {
        "/init": [
          "iface eth0 add 192.168.0.1/24",
          "route add 192.168.0.0/24 dev eth0",
          "br add br0 eth1 eth2",
          "iface br0 up",
          "iface br0 add 10.0.0.1/24",
          "route add 10.0.0.0/24 dev br0",
          "dhcpd br0 10.0.0.10 10.0.0.20 -g 10.0.0.1 &",
          "fw masquerade eth0",
        ].join("\n"),
      },
      ui: { x: 150, y: 100 },
    },
    {
      id: "sw",
      type: "l2",
      name: "Switch",
      ports: new Array(16).fill(0).map((_, i) => ({ id: `eth${i}`, type: "ethernet" })),
      ui: { x: 250, y: 100 },
      fs: {},
    },
    {
      id: "server",
      type: "server",
      name: "Server",
      ports: [
        { id: "eth0", type: "ethernet" },
        { id: "eth1", type: "ethernet" },
      ],
      ethernetPorts: [
        { id: "eth0", mac: "00:00:00:bb:00:00" },
        { id: "eth1", mac: "00:00:00:bb:00:01" },
      ],
      fs: {
        "/init": [
          "iface eth0 add 192.168.0.100/24",
          "route add 192.168.0.0/24 dev eth0",
          "route add default via 192.168.0.1",
        ].join("\n"),
      },
      ui: { x: 150, y: 200 },
    },
    {
      id: "pc_a",
      type: "pc",
      name: "PC A",
      ports: [{ id: "eth0", type: "ethernet" }],
      ethernetPorts: [{ id: "eth0", mac: "00:00:00:aa:00:00" }],
      fs: { "/init": ["dhcp eth0"].join("\n") },
      ui: { x: 50, y: 100 },
    },
    {
      id: "pc_b",
      type: "pc",
      name: "PC B",
      ports: [{ id: "eth0", type: "ethernet" }],
      ethernetPorts: [{ id: "eth0", mac: "00:00:00:aa:01:00" }],
      fs: { "/init": ["dhcp eth0"].join("\n") },
      ui: { x: 350, y: 100 },
    },
  ],
  connections: [
    { id: "server-router", a_id: "server", a_pid: "eth0", b_id: "router", b_pid: "eth0", delay: 0, speed: 1_000_000 },
    { id: "pc_a-router", a_id: "pc_a", a_pid: "eth0", b_id: "router", b_pid: "eth1", delay: 0, speed: 1_000_000 },
    { id: "router-sw", a_id: "router", a_pid: "eth2", b_id: "sw", b_pid: "eth0", delay: 0, speed: 1_000_000 },
    { id: "pc_b-sw", a_id: "pc_b", a_pid: "eth0", b_id: "sw", b_pid: "eth1", delay: 0, speed: 1_000_000 },
  ],
};
