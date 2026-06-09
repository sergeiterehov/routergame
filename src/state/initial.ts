import type { TArchitecture } from "./store";

export const initial_arch: TArchitecture = {
  title: "Test",
  node: [
    {
      id: "router",
      type: "os",
      category: "router",
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
          "netd &",
          "pkg install dhcp",
          "dhcp_server br0 10.0.0.10 10.0.0.20 -g 10.0.0.1 -dns 192.168.0.100 &",
        ].join("\n"),
        "/netd.json": JSON.stringify(
          {
            interfaces: [
              { id: "eth0", ref: null!, name: "eth0", type: { type: "ethernet", up: true } },
              { id: "eth1", ref: null!, name: "eth1", type: { type: "ethernet", up: true } },
              { id: "eth2", ref: null!, name: "eth2", type: { type: "ethernet", up: true } },
              { id: "eth3", ref: null!, name: "eth3", type: { type: "ethernet", up: true } },
              { id: "eth4", ref: null!, name: "eth4", type: { type: "ethernet", up: true } },
              { id: "eth5", ref: null!, name: "eth5", type: { type: "ethernet", up: true } },
              { id: "eth6", ref: null!, name: "eth6", type: { type: "ethernet", up: true } },
              { id: "eth7", ref: null!, name: "eth7", type: { type: "ethernet", up: true } },
              {
                id: "br0",
                ref: null!,
                name: "br0",
                type: { type: "bridge", up: true, pvid: 1, vlan_filtering: false },
              },
            ],
            bridge_ports: [
              {
                id: "bp1",
                ref: null!,
                bridge_id: "br0",
                port_id: "eth1",
                pvid: 1,
                tagged: [],
                untagged: [],
              },
              {
                id: "bp2",
                ref: null!,
                bridge_id: "br0",
                port_id: "eth2",
                pvid: 1,
                tagged: [],
                untagged: [],
              },
            ],
            ips: [
              { id: "ip1", interface_id: "eth0", address: "192.168.0.1/24" },
              { id: "ip2", interface_id: "br0", address: "10.0.0.1/24" },
            ],
            ip_routes: [
              { id: "r1", ref: null!, interface_id: "eth0", network: "192.168.0.0/24" },
              { id: "r2", ref: null!, interface_id: "br0", network: "10.0.0.0/24" },
            ],
            fw_enable: true,
            fw: [
              {
                id: "fw1",
                ref: null!,
                table: "nat",
                chain: "src-nat",
                action: { type: "masquerade" },
                out_interface_ids: ["eth0"],
              },
            ],
          },
          undefined,
          2,
        ),
      },
      ui: { x: 150, y: 200 },
    },
    {
      id: "sw",
      type: "switch",
      category: "switch",
      name: "Switch",
      ports: new Array(16).fill(0).map((_, i) => ({ id: `eth${i}`, type: "ethernet" })),
      ui: { x: 200, y: 300 },
      fs: {},
    },
    {
      id: "server",
      type: "os",
      category: "server",
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
          "pkg install net_tools iputils bind8 nginy",
          "iface eth0 wait link",
          "iface eth0 add 192.168.0.100/24",
          "route add 192.168.0.0/24 dev eth0",
          "route add default via 192.168.0.1",
          "bind8 &",
          "nginy &",
        ].join("\n"),
        "/names.conf": `
# NAME TYPE VALUE TTL
example.com A 192.168.0.100 3600
dns.google A 8.8.8.8 3600
ya.ru A 77.88.44.242 3600
ya.ru A 77.88.55.242 3600
        `.trim(),
        "/nginy.yaml": `
server:
  - listen: 80
    hostname: example.com

    location:
      /:
        - add_header: ContentType text/html
        - status: 200
        - body: '<html><body>Hello, <a href="/profile">user</a>!</body></html>'
      /profile:
        - add_header: ContentType application/json
        - status: 403
        - body: '{"error": "Access deny"}'
        `.trim(),
      },
      ui: { x: 150, y: 100 },
    },
    {
      id: "pc_a",
      type: "os",
      category: "pc",
      name: "PC A",
      ports: [{ id: "eth0", type: "ethernet" }],
      ethernetPorts: [{ id: "eth0", mac: "00:00:00:aa:00:00" }],
      fs: {
        "/init": ["pkg install net_tools iputils dhcp", "iface eth0 wait link", "sleep 1", "dhclient eth0"].join("\n"),
        "/etc/hosts": "127.0.0.1 localhost",
      },
      ui: { x: 100, y: 300 },
    },
    {
      id: "pc_b",
      type: "os",
      category: "pc",
      name: "PC B",
      ports: [{ id: "eth0", type: "ethernet" }],
      ethernetPorts: [{ id: "eth0", mac: "00:00:00:aa:01:00" }],
      fs: {
        "/init": ["pkg install net_tools iputils dhcp", "iface eth0 wait link", "sleep 1", "dhclient eth0"].join("\n"),
        "/etc/hosts": "127.0.0.1 localhost",
      },
      ui: { x: 200, y: 400 },
    },
  ],
  connections: [
    { id: "server-router", a_id: "server", a_pid: "eth0", b_id: "router", b_pid: "eth0", delay: 0, speed: 1_000_000 },
    { id: "pc_a-router", a_id: "pc_a", a_pid: "eth0", b_id: "router", b_pid: "eth1", delay: 0, speed: 1_000_000 },
    { id: "router-sw", a_id: "router", a_pid: "eth2", b_id: "sw", b_pid: "eth0", delay: 0, speed: 1_000_000 },
    { id: "pc_b-sw", a_id: "pc_b", a_pid: "eth0", b_id: "sw", b_pid: "eth1", delay: 0, speed: 1_000_000 },
  ],
};
