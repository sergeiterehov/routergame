import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Net, TInterface } from "./net";
import { Socket } from "./socket";
import { parseIPv4 } from "../format";
import type { TRoute } from "./ip4";
import { IP_PROTOCOLS, pack_tcp_packet, TCP_FLAGS, unpack_tcp_packet } from "../pack";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const DEFAULT_IP_HEADER = {
  version: 4,
  src: 0,
  dst: 0,
  flags: 0,
  ttl: 64,
  protocol: IP_PROTOCOLS.TCP,
  id: 0,
  offset: 0,
  length: 0,
  ihl: 0,
  options: [],
  tos: 0,
  checksum: 0,
};

const DEFAULT_TCP_HEADER = {
  src: 0,
  dst: 0,
  flags: 0,
  ack: 0,
  seq: 0,
  checksum: 0,
  data_offset: 0,
  options: [],
  urgent: 0,
  window: 65535,
};

const iface_mock: TInterface = {
  index: 0,
  mtu: 1500,
  min_mtu: 68,
  max_mtu: 1500,
  type: "ethernet",
  name: "eth0",
  flags: { UP: true },
  mac: 0n,
  iDriver: 0,
  ips: [],
};

// Mock для Net
const net_mock = {
  ip4: {
    route: vi.fn(),
    send: vi.fn(),
    send_raw: vi.fn(),
  },
  iface: vi.fn(() => iface_mock),
};

const createInstance = () => new Socket(net_mock as unknown as Net);

describe("Socket TCP: Клиентский режим", () => {
  it("открываем, обмениваемся, закрывают", () => {
    const instance = createInstance();
    const socket = instance.create("tcp");

    net_mock.ip4.route.mockReturnValue({
      network: 0,
      prefix: 0,
      iInterface: 0,
      gateway: parseIPv4("10.0.0.1"),
      src: parseIPv4("10.0.0.2"),
    } as TRoute);

    const dst_ip = parseIPv4("8.8.8.8");
    const dst_port = 80;
    const src_ip = parseIPv4("10.0.0.2");
    let src_port = 0;
    let rcv_nxt = 0;
    let snd_nxt = 0;

    const _expect_send = () => {
      expect(net_mock.ip4.send).toHaveBeenCalled();

      const { 3: payload } = net_mock.ip4.send.mock.lastCall!;

      const tcp = unpack_tcp_packet(payload);
      expect(tcp.header.dst).toBe(dst_port);

      src_port = tcp.header.src;
      rcv_nxt = tcp.header.seq + tcp.payload.length;
      snd_nxt = tcp.header.ack;

      net_mock.ip4.send.mockReset();

      return tcp;
    };

    const _ip_header = {
      ...DEFAULT_IP_HEADER,
      src: dst_ip,
      dst: src_ip,
    };
    const _get_tcp_header = (flags: number) => ({
      ...DEFAULT_TCP_HEADER,
      src: dst_port,
      dst: src_port,
      flags,
      ack: rcv_nxt,
      seq: snd_nxt,
    });

    // open socket
    expect(instance.connect(socket, dst_ip, dst_port)).toBe(0);
    expect(socket.state).toBe("syn_sent");

    // recv SYN
    expect(_expect_send()).toEqual(
      expect.objectContaining({
        header: expect.objectContaining({ flags: TCP_FLAGS.SYN }),
      }),
    );

    expect(socket.retry_queue).toHaveLength(1);

    expect(rcv_nxt).toBe(1000);
    expect(snd_nxt).toBe(0);

    rcv_nxt += 1;
    snd_nxt = 5000;

    // send SYN+ACK
    instance.handle_packet(iface_mock.index, {
      header: _ip_header,
      payload: pack_tcp_packet({
        header: {
          ..._get_tcp_header(TCP_FLAGS.SYN + TCP_FLAGS.ACK),
          options: [{ kind: 2, data: new Uint8Array([0x00, 0x50]) }],
        },
        payload: new Uint8Array(),
      }),
    });

    expect(socket.state).toBe("established");

    // recv ACK
    expect(_expect_send()).toEqual(
      expect.objectContaining({
        header: expect.objectContaining({ flags: TCP_FLAGS.ACK }),
      }),
    );

    expect(socket.retry_queue).toHaveLength(0);

    expect(rcv_nxt).toBe(1001);
    expect(snd_nxt).toBe(5001);

    // Send some data from socket
    const socket_data = new Uint8Array([1, 2, 3, 4, 5]);
    instance.send(socket, socket_data);

    // put unacked packets in queue
    expect(socket.retry_queue).toHaveLength(1);

    // recv ACK + data
    expect(_expect_send()).toEqual(
      expect.objectContaining({
        header: expect.objectContaining({ flags: TCP_FLAGS.ACK }),
        payload: socket_data,
      }),
    );

    expect(rcv_nxt).toBe(1006);
    expect(snd_nxt).toBe(5001);

    // send ACK
    instance.handle_packet(iface_mock.index, {
      header: _ip_header,
      payload: pack_tcp_packet({
        header: _get_tcp_header(TCP_FLAGS.ACK),
        payload: new Uint8Array(),
      }),
    });

    // ack should remove some_data from queue
    expect(socket.retry_queue).toHaveLength(0);

    // Send some data from server
    const server_data = new Uint8Array([6, 7, 8, 9, 10, 11]);
    instance.handle_packet(iface_mock.index, {
      header: _ip_header,
      payload: pack_tcp_packet({
        header: _get_tcp_header(TCP_FLAGS.ACK),
        payload: server_data,
      }),
    });

    // recv ACK
    expect(_expect_send()).toEqual(
      expect.objectContaining({
        header: expect.objectContaining({ flags: TCP_FLAGS.ACK }),
      }),
    );

    expect(rcv_nxt).toBe(1006);
    expect(snd_nxt).toBe(5007);

    expect(instance._3_way_closing).toBe(true);

    // server initiated close
    instance.handle_packet(iface_mock.index, {
      header: _ip_header,
      payload: pack_tcp_packet({
        header: _get_tcp_header(TCP_FLAGS.FIN),
        payload: new Uint8Array(),
      }),
    });

    // recv FIN+ACK
    expect(_expect_send()).toEqual(
      expect.objectContaining({
        header: expect.objectContaining({ flags: TCP_FLAGS.FIN + TCP_FLAGS.ACK }),
      }),
    );

    expect(socket.state).toBe("last_ack");

    // server send last ACK
    instance.handle_packet(iface_mock.index, {
      header: _ip_header,
      payload: pack_tcp_packet({
        header: _get_tcp_header(TCP_FLAGS.ACK),
        payload: new Uint8Array(),
      }),
    });

    expect(socket.state).toBe("closed");
  });
});

describe("Socket TCP: Серверный режим (bind)", () => {
  it("слушаем, принимаем, обмениваемся, закрываем", () => {
    const instance = createInstance();
    const bind_socket = instance.create("tcp");

    const on_connected_fn = vi.fn();
    bind_socket.on_connected = on_connected_fn;

    expect(instance._sockets).toHaveLength(1);

    net_mock.ip4.route.mockReturnValue({
      network: 0,
      prefix: 0,
      iInterface: 0,
      gateway: parseIPv4("8.0.0.1"),
      src: parseIPv4("8.8.8.8"),
    } as TRoute);

    const dst_ip = parseIPv4("8.8.8.8");
    const dst_port = 80;
    const src_ip = parseIPv4("10.0.0.2");
    const src_port = 12345;
    let rcv_nxt = 0;
    let snd_nxt = 5000;

    const _expect_send = () => {
      expect(net_mock.ip4.send).toHaveBeenCalled();

      const { 3: payload } = net_mock.ip4.send.mock.lastCall!;

      const tcp = unpack_tcp_packet(payload);
      expect(tcp.header.dst).toBe(src_port);

      rcv_nxt = tcp.header.seq + tcp.payload.length;
      snd_nxt = tcp.header.ack;

      net_mock.ip4.send.mockReset();

      return tcp;
    };

    const _ip_header = {
      ...DEFAULT_IP_HEADER,
      src: src_ip,
      dst: dst_ip,
    };
    const _get_tcp_header = (flags: number) => ({
      ...DEFAULT_TCP_HEADER,
      src: src_port,
      dst: dst_port,
      flags,
      ack: rcv_nxt,
      seq: snd_nxt,
    });

    const _send = (flags: number, payload: Uint8Array = new Uint8Array()) => {
      instance.handle_packet(iface_mock.index, {
        header: _ip_header,
        payload: pack_tcp_packet({
          header: _get_tcp_header(flags),
          payload,
        }),
      });
      snd_nxt += payload.length;
    };

    const _expect_recv = (flags: number, payload: Uint8Array = new Uint8Array()) => {
      expect(_expect_send()).toEqual(
        expect.objectContaining({
          header: expect.objectContaining({ flags }),
          payload,
        }),
      );
    };

    // open socket
    expect(instance.bind(bind_socket, dst_ip, dst_port)).toBe(0);
    expect(bind_socket.state).toBe("listen");

    _send(TCP_FLAGS.SYN);

    expect(instance._sockets).toHaveLength(2);
    const socket = instance._sockets[1];

    _expect_recv(TCP_FLAGS.SYN + TCP_FLAGS.ACK);
    rcv_nxt += 1;

    expect(socket.state).toBe("syn_received");

    _send(TCP_FLAGS.ACK);

    expect(rcv_nxt).toBe(1001);
    expect(snd_nxt).toBe(5001);

    expect(socket.state).toBe("established");

    expect(on_connected_fn).toHaveBeenCalledWith(socket);

    _send(TCP_FLAGS.ACK, new Uint8Array([1, 2, 3]));
    _expect_recv(TCP_FLAGS.ACK);

    expect(rcv_nxt).toBe(1001);
    expect(snd_nxt).toBe(5004);

    instance.send(socket, new Uint8Array([4, 5, 6]));
    _expect_recv(TCP_FLAGS.ACK, new Uint8Array([4, 5, 6]));
    _send(TCP_FLAGS.ACK);

    expect(rcv_nxt).toBe(1004);
    expect(snd_nxt).toBe(5004);

    const on_close_fn = vi.fn();
    socket.on_close = on_close_fn;

    instance.close(socket);
    _expect_recv(TCP_FLAGS.FIN);
    expect(socket.state).toBe("fin_wait_1");

    _send(TCP_FLAGS.ACK);
    expect(socket.state).toBe("fin_wait_2");

    _send(TCP_FLAGS.FIN);
    _expect_recv(TCP_FLAGS.ACK);
    expect(socket.state).toBe("time_wait");

    expect(on_close_fn).toHaveBeenCalled();

    vi.advanceTimersByTime(100_000);

    expect(socket.state).toBe("closed");
    expect(instance._sockets).toHaveLength(1);
  });
});
