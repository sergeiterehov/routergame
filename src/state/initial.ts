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
          "dhcp_server [net interface find --name br0 - .name] 10.0.0.10 10.0.0.20 -g 10.0.0.1 -dns 192.168.0.100 &",
        ].join("\n"),
        "/netd": `{"version":1,"interface":{"list":[{"id":"j4ze0z","name":"eth0","mac":"00:00:00:ff:00:00","type":"ethernet","props":{"default_name":"eth0"}},{"id":"j33get","name":"eth1","mac":"00:00:00:ff:00:01","type":"ethernet","props":{"default_name":"eth1"}},{"id":"k1ekku","name":"eth2","mac":"00:00:00:ff:00:02","type":"ethernet","props":{"default_name":"eth2"}},{"id":"d7nfl9","name":"eth3","mac":"00:00:00:ff:00:03","type":"ethernet","props":{"default_name":"eth3"}},{"id":"elberd","name":"eth4","mac":"00:00:00:ff:00:04","type":"ethernet","props":{"default_name":"eth4"}},{"id":"pz1dum","name":"eth5","mac":"00:00:00:ff:00:05","type":"ethernet","props":{"default_name":"eth5"}},{"id":"aumo8t","name":"eth6","mac":"00:00:00:ff:00:06","type":"ethernet","props":{"default_name":"eth6"}},{"id":"lzq84h","name":"eth7","mac":"00:00:00:ff:00:07","type":"ethernet","props":{"default_name":"eth7"}},{"id":"s8era2","name":"br0","mac":"00:00:00:00:00:00","type":"bridge","props":{"pvid":1,"vlan_filtering":false}}]},"interface__bridge__port":{"list":[{"id":"comr0u","bridge_interface_id":"s8era2","port_interface_id":"j33get","pvid":1,"tagged":[],"untagged":[]},{"id":"980999","bridge_interface_id":"s8era2","port_interface_id":"k1ekku","pvid":1,"tagged":[],"untagged":[]}]},"ip__address":{"list":[{"id":"760wv4","address":"192.168.0.1/24","interface_id":"j4ze0z"},{"id":"8lcza7","address":"10.0.0.1/24","interface_id":"s8era2"}]},"ip__route":{"list":[]},"ip__firewall":{"list":[{"id":"5qhv2l","table":"nat","chain":"src-nat","action":{"type":"masquerade"},"out_interface_ids":["j4ze0z"]}]}}`,
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
