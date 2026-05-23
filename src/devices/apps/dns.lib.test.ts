import { describe, it, expect, vi, beforeEach } from "vitest";
import { get_hostname_ip, answer_dns, DNS_CLASSES, DNS_TYPES } from "./dns.lib";
import type { OS } from "../os/os";
import { parseIPv4 } from "../format";
import type { TInterface } from "../os/net";

describe("get_hostname_ip", () => {
  // Mock OS object
  const _os = {
    fs: {
      exists: vi.fn(),
      read: vi.fn(),
    },
    net: {
      socket: {
        create: vi.fn(),
        connect: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      },
    },
  };

  const os = _os as unknown as OS;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();

    // Default mock implementations
    _os.fs.exists.mockReturnValue(false);
    _os.fs.read.mockReturnValue("");
    _os.net.socket.create.mockReturnValue({});
    _os.net.socket.connect.mockReturnValue(0);
    _os.net.socket.send.mockReturnValue(0);
  });

  it("should return IP from /etc/hosts if hostname is found", async () => {
    // Arrange
    const hostname = "example.com";
    const ip = "192.168.1.100";

    _os.fs.exists.mockReturnValue(true);
    _os.fs.read.mockReturnValue(`${ip} ${hostname}\n10.0.0.1 other.com`);

    // Act
    const result = await get_hostname_ip(os, hostname);

    // Assert
    expect(result).toBe(parseIPv4(ip));
    expect(os.fs.exists).toHaveBeenCalledWith("/etc/hosts");
    expect(os.fs.read).toHaveBeenCalledWith("/etc/hosts");
    // Should not attempt DNS query if found in hosts file
    expect(os.net.socket.create).not.toHaveBeenCalled();
  });

  it("should ignore invalid IP in /etc/hosts", async () => {
    // Arrange
    const hostname = "example.com";

    _os.fs.exists.mockReturnValue(true);
    _os.fs.read.mockReturnValue(`invalid_ip ${hostname}\n10.0.0.1 other.com`);

    // Act
    await expect(get_hostname_ip(os, hostname)).rejects.toThrow();

    // Assert
    expect(os.fs.exists).toHaveBeenCalledWith("/etc/hosts");
    expect(os.fs.read).toHaveBeenCalledWith("/etc/hosts");
    // Should not attempt DNS query if found but invalid in hosts file
    expect(os.net.socket.create).not.toHaveBeenCalled();
  });

  it("should ignore commented lines in /etc/hosts", async () => {
    // Arrange
    const hostname = "example.com";
    const ip = "192.168.1.100";

    _os.fs.exists.mockReturnValue(true);
    _os.fs.read.mockReturnValue(`# ${ip} ${hostname}\n10.0.0.1 other.com`);

    // Act
    await expect(get_hostname_ip(os, hostname)).rejects.toThrow();

    // Assert
    expect(os.fs.exists).toHaveBeenCalledWith("/etc/hosts");
    expect(os.fs.read).toHaveBeenCalledWith("/etc/hosts");
  });

  it("should use DNS from /etc/resolv.conf if not found in /etc/hosts", async () => {
    // Arrange
    const hostname = "example.com";
    const dnsIp = "8.8.8.8";

    // Hosts file doesn't contain the hostname
    _os.fs.exists.mockImplementation((path) => (path === "/etc/hosts" ? true : path === "/etc/resolv.conf"));
    _os.fs.read.mockImplementation((path) => {
      if (path === "/etc/hosts") return "10.0.0.1 other.com";
      if (path === "/etc/resolv.conf") return `nameserver ${dnsIp}`;
      return "";
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    // Act
    await expect(get_hostname_ip(os, hostname, undefined, controller.signal)).rejects.toThrow();

    // Assert
    expect(os.fs.exists).toHaveBeenCalledWith("/etc/hosts");
    expect(os.fs.exists).toHaveBeenCalledWith("/etc/resolv.conf");
    expect(os.fs.read).toHaveBeenCalledWith("/etc/hosts");
    expect(os.fs.read).toHaveBeenCalledWith("/etc/resolv.conf");
    expect(os.net.socket.create).toHaveBeenCalledWith("udp");
  });

  it("should use provided DNS server if specified", async () => {
    // Arrange
    const hostname = "example.com";
    const dnsIp = "1.1.1.1";

    // Hosts file doesn't contain the hostname
    _os.fs.exists.mockReturnValue(true);
    _os.fs.read.mockReturnValue("10.0.0.1 other.com");

    // Mock DNS response
    const socket = os.net.socket.create("udp");
    socket.on_recv = vi.fn();

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    // Act
    await expect(get_hostname_ip(os, hostname, parseIPv4(dnsIp), controller.signal)).rejects.toThrow();

    // Assert
    expect(os.fs.exists).toHaveBeenCalledWith("/etc/hosts");
    expect(os.fs.read).toHaveBeenCalledWith("/etc/hosts");
    expect(os.net.socket.create).toHaveBeenCalledWith("udp");
    expect(os.net.socket.connect).toHaveBeenCalledWith(socket, parseIPv4(dnsIp), 53);
    // Should not read /etc/resolv.conf when DNS is provided
    expect(os.fs.exists).not.toHaveBeenCalledWith("/etc/resolv.conf");
  });

  it("should throw error if no DNS server is available", async () => {
    // Arrange
    const hostname = "example.com";

    // Hosts file doesn't contain the hostname
    _os.fs.exists.mockImplementation((path) => (path === "/etc/hosts" ? true : false));
    _os.fs.read.mockReturnValue("10.0.0.1 other.com");

    // Act
    await expect(get_hostname_ip(os, hostname)).rejects.toThrow();

    // Assert
    expect(os.fs.exists).toHaveBeenCalledWith("/etc/hosts");
    expect(os.fs.exists).toHaveBeenCalledWith("/etc/resolv.conf");
    expect(os.net.socket.create).not.toHaveBeenCalled();
  });

  it("should handle DNS response with correct answer", async () => {
    _os.net.socket.create.mockReturnValue({});

    // Arrange
    const hostname = "example.com";
    const dnsIp = "8.8.8.8";
    const responseIp = "93.184.216.34"; // example.com IP

    // Hosts file doesn't contain the hostname
    _os.fs.exists.mockImplementation((path) => (path === "/etc/hosts" ? true : path === "/etc/resolv.conf"));
    _os.fs.read.mockImplementation((path) => {
      if (path === "/etc/hosts") return "10.0.0.1 other.com";
      if (path === "/etc/resolv.conf") return `nameserver ${dnsIp}`;
      return "";
    });

    // Create a mock DNS response
    const response = new Uint8Array(512);
    const dv = new DataView(response.buffer);

    // Set flags (response, no error)
    dv.setUint16(2, 0x8180);

    // Set question count to 1
    dv.setUint16(4, 1);

    // Set answer count to 1
    dv.setUint16(6, 1);

    // Skip question section (simplified)
    let offset = 12;
    const segments = hostname.split(".");
    for (const segment of segments) {
      dv.setUint8(offset++, segment.length);
      const bytes = new TextEncoder().encode(segment);
      response.set(bytes, offset);
      offset += bytes.length;
    }
    dv.setUint8(offset++, 0); // End of domain name
    dv.setUint16(offset, 0x0001); // QTYPE (A record)
    offset += 2;
    dv.setUint16(offset, 0x0001); // QCLASS (IN)
    offset += 2;

    // Answer section
    dv.setUint16(offset, 0xc00c); // Pointer to domain name
    offset += 2;
    dv.setUint16(offset, 0x0001); // TYPE (A record)
    offset += 2;
    dv.setUint16(offset, 0x0001); // CLASS (IN)
    offset += 2;
    dv.setUint32(offset, 300); // TTL
    offset += 4;
    dv.setUint16(offset, 4); // RDLENGTH
    offset += 2;

    // RDATA (IP address)
    const ipParts = responseIp.split(".").map(Number);
    for (const part of ipParts) {
      dv.setUint8(offset++, part);
    }

    // Mock the socket response
    const socket = os.net.socket.create("udp");

    _os.net.socket.send.mockImplementationOnce((socket, data: Uint8Array) => {
      dv.setUint16(0, (data[0] << 8) + data[1]);
    });

    // Act
    const resultPromise = get_hostname_ip(os, hostname);

    // Simulate the DNS response
    setTimeout(() => {
      socket.on_recv?.({ data: response, iface: {} as TInterface, ip: 0, port: 0 });
    }, 10);

    const result = await resultPromise;

    // Assert
    expect(result).toBe(parseIPv4(responseIp));
    expect(os.net.socket.send).toHaveBeenCalled();
  });

  it("should throw error for DNS response with error", async () => {
    // Arrange
    const hostname = "example.com";
    const dnsIp = "8.8.8.8";

    // Hosts file doesn't contain the hostname
    _os.fs.exists.mockImplementation((path) => (path === "/etc/hosts" ? true : path === "/etc/resolv.conf"));
    _os.fs.read.mockImplementation((path) => {
      if (path === "/etc/hosts") return "10.0.0.1 other.com";
      if (path === "/etc/resolv.conf") return `nameserver ${dnsIp}`;
      return "";
    });

    // Create a mock DNS response with error
    const response = new Uint8Array(512);
    const dv = new DataView(response.buffer);

    // Set flags with error (SERVFAIL)
    dv.setUint16(2, 0x8183);

    _os.net.socket.send.mockImplementationOnce((socket, data: Uint8Array) => {
      dv.setUint16(0, (data[0] << 8) + data[1]);
    });

    // Mock the socket response
    const socket = os.net.socket.create("udp");

    // Act
    const resultPromise = get_hostname_ip(os, hostname);

    // Simulate the DNS response
    setTimeout(() => {
      if (socket.on_recv) {
        socket.on_recv({ data: response, iface: {} as TInterface, ip: 0, port: 0 });
      }
    }, 10);

    await expect(resultPromise).rejects.toThrow();
  });

  it("should handle aborted signal", async () => {
    // Arrange
    const hostname = "example.com";
    const controller = new AbortController();

    // Abort the signal immediately
    controller.abort();

    // Act
    await expect(get_hostname_ip(os, hostname, undefined, controller.signal)).rejects.toThrow();

    // Assert
    // Should not make any network calls
    expect(os.net.socket.create).not.toHaveBeenCalled();
  });

  it("should clean up socket event handlers", async () => {
    _os.net.socket.create.mockReturnValue({});

    // Arrange
    const hostname = "example.com";
    const dnsIp = "8.8.8.8";

    // Hosts file doesn't contain the hostname
    _os.fs.exists.mockImplementation((path) => (path === "/etc/hosts" ? true : path === "/etc/resolv.conf"));
    _os.fs.read.mockImplementation((path) => {
      if (path === "/etc/hosts") return "10.0.0.1 other.com";
      if (path === "/etc/resolv.conf") return `nameserver ${dnsIp}`;
      return "";
    });

    // Mock the socket
    const socket = os.net.socket.create("udp");

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    // Act
    await expect(get_hostname_ip(os, hostname, undefined, controller.signal)).rejects.toThrow();

    // Assert
    expect(os.net.socket.close).toHaveBeenCalled();
    expect(socket.on_recv).toBeNullable();
    expect(socket.on_close).toBeNullable();
    expect(socket.on_error).toBeNullable();
  });
});

describe("answer_dns", () => {
  const mockOnName = vi.fn();
  const request = new Uint8Array(512);
  const $ = new DataView(request.buffer);

  beforeEach(() => {
    vi.clearAllMocks();
    $.setUint16(0, 12345); // Set ID
  });

  it("should create a valid DNS response with correct header", () => {
    // Arrange
    mockOnName.mockReturnValue([]);

    // Act
    const response = answer_dns(request, mockOnName);
    const $ = new DataView(response.buffer);

    // Assert
    expect($.getUint16(0)).toBe(12345); // ID should be copied
    expect($.getUint16(2)).toBe(0x8180); // QR=1, RD=1, RA=1 (0x8000 | 0x0100 | 0x0080)
  });

  it("should include answer records when found", () => {
    // Arrange
    const record = {
      type: DNS_TYPES.A,
      class: DNS_CLASSES.IN,
      name: "example.com",
      text: "192.168.1.100",
      ttl: 300,
      expired_at: Date.now() + 300000,
    };
    mockOnName.mockReturnValue([record]);

    // Create a simple request with one question
    $.setUint16(4, 1); // QDCOUNT = 1
    const nameBytes = new TextEncoder().encode("\x07example\x03com\x00");
    request.set(nameBytes, 12); // Encode domain name
    $.setUint16(12 + nameBytes.length, DNS_TYPES.A);
    $.setUint16(12 + nameBytes.length + 2, DNS_CLASSES.IN);
    const a_offset = 12 + nameBytes.length + 4;

    // Act
    const response = answer_dns(request, mockOnName);
    const $res = new DataView(response.buffer);

    const res_a_name = new Uint8Array([0xc0, 0x0c]);

    // Assert
    expect($res.getUint16(6)).toBe(1); // ANCOUNT = 1
    expect($res.getUint16(a_offset + res_a_name.length)).toBe(DNS_TYPES.A); // TYPE
    expect($res.getUint16(a_offset + res_a_name.length + 2)).toBe(DNS_CLASSES.IN); // CLASS
    expect($res.getUint32(a_offset + res_a_name.length + 4)).toBe(300); // TTL
    expect($res.getUint16(a_offset + res_a_name.length + 8)).toBe(4); // RDLENGTH
    // Verify IP address bytes
    expect(response[a_offset + res_a_name.length + 10]).toBe(192);
    expect(response[a_offset + res_a_name.length + 11]).toBe(168);
    expect(response[a_offset + res_a_name.length + 12]).toBe(1);
    expect(response[a_offset + res_a_name.length + 13]).toBe(100);
  });
});
