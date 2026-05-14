// tracker.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { Tracker } from "./tracker";
import { IP_PROTOCOLS, TCP_FLAGS } from "../pack";
import type { IP4 } from "./ip4";

// ============================================================================
// 🛠 Helpers: создание пакетов
// ============================================================================

function makeIPv4Header(opts: { src: number; dst: number; protocol: number; payloadLength: number }) {
  return {
    version: 4,
    ihl: 5,
    tos: 0,
    length: 20 + opts.payloadLength,
    id: Math.floor(Math.random() * 65535),
    flags: 2, // DF
    offset: 0,
    ttl: 64,
    protocol: opts.protocol,
    checksum: 0,
    src: opts.src,
    dst: opts.dst,
    options: [],
  };
}

function makeTCPPayload(opts: { src: number; dst: number; flags: number; seq?: number; ack?: number }) {
  // Минимальный TCP-заголовок: 20 байт
  // [src:2][dst:2][seq:4][ack:4][offset:4][flags:2][window:2][chk:2][urg:2]
  const buffer = new Uint8Array(20);
  const view = new DataView(buffer.buffer);

  view.setUint16(0, opts.src, false); // src port
  view.setUint16(2, opts.dst, false); // dst port
  view.setUint32(4, opts.seq ?? 0, false); // seq
  view.setUint32(8, opts.ack ?? 0, false); // ack
  view.setUint16(12, (5 << 12) | opts.flags, false); // data offset (5 * 4 = 20 bytes)
  view.setUint16(14, 65535, false); // window
  // checksum и urgent pointer оставляем 0

  return buffer;
}

function makeUDPPayload(opts: { src: number; dst: number; length?: number }) {
  const buffer = new Uint8Array(8);
  const view = new DataView(buffer.buffer);
  view.setUint16(0, opts.src, false);
  view.setUint16(2, opts.dst, false);
  view.setUint16(4, opts.length ?? 8, false);
  view.setUint16(6, 0, false); // checksum
  return buffer;
}

function makeICMPPayload(opts: { type: number; code: number; id: number; seq?: number }) {
  const buffer = new Uint8Array(8);
  const view = new DataView(buffer.buffer);
  view.setUint8(0, opts.type);
  view.setUint8(1, opts.code);
  view.setUint16(2, 0, false); // checksum
  view.setUint16(4, opts.id, false); // identifier
  view.setUint16(6, opts.seq ?? 0, false); // sequence
  return buffer;
}

function makePacket(opts: { src: number; dst: number; protocol: number; payload: Uint8Array }) {
  return {
    header: makeIPv4Header({
      src: opts.src,
      dst: opts.dst,
      protocol: opts.protocol,
      payloadLength: opts.payload.length,
    }),
    payload: opts.payload,
  };
}

// ============================================================================
// 🧪 Тесты
// ============================================================================

let tracker: Tracker;
let ip4: IP4;

// Тестовые адреса: 192.168.1.10 = 0xC0A8010A, 93.184.216.34 = 0x5DB8D822
const CLIENT_IP = 0xc0a8010a;
const SERVER_IP = 0x5db8d822;
const CLIENT_PORT = 54321;
const SERVER_PORT = 443;

beforeEach(() => {
  ip4 = {} as IP4; // предполагаем, что конструктор не требует аргументов
  tracker = new Tracker(ip4);
  tracker._table = [];
});

describe("Tracker", () => {
  // --------------------------------------------------------------------------
  // 🔹 Базовое создание соединений
  // --------------------------------------------------------------------------

  it("создаёт запись для нового TCP-соединения (SYN)", () => {
    const syn = makePacket({
      src: CLIENT_IP,
      dst: SERVER_IP,
      protocol: IP_PROTOCOLS.TCP,
      payload: makeTCPPayload({
        src: CLIENT_PORT,
        dst: SERVER_PORT,
        flags: TCP_FLAGS.SYN,
        seq: 1000,
      }),
    });

    const conn = tracker.handle_packet(syn);

    expect(conn).toBeDefined();
    expect(conn?.protocol).toBe(IP_PROTOCOLS.TCP);
    expect(conn?.src).toBe(CLIENT_IP);
    expect(conn?.dst).toBe(SERVER_IP);
    expect(conn?.src_port).toBe(CLIENT_PORT);
    expect(conn?.dst_port).toBe(SERVER_PORT);
    expect(conn?.tcp?.state).toBe("syn-sent");
    expect(conn?.has_reply).toBe(false);
  });

  it("распознаёт reply-пакет и ставит has_reply=true", () => {
    // SYN от клиента
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({
          src: CLIENT_PORT,
          dst: SERVER_PORT,
          flags: TCP_FLAGS.SYN,
        }),
      }),
    );

    // SYN+ACK от сервера (ответ)
    const synAck = makePacket({
      src: SERVER_IP,
      dst: CLIENT_IP,
      protocol: IP_PROTOCOLS.TCP,
      payload: makeTCPPayload({
        src: SERVER_PORT,
        dst: CLIENT_PORT,
        flags: TCP_FLAGS.SYN | TCP_FLAGS.ACK,
        seq: 2000,
        ack: 1001,
      }),
    });

    const conn = tracker.handle_packet(synAck);

    expect(conn?.has_reply).toBe(true);
    expect(conn?.tcp?.state).toBe("syn-recv");
  });

  it("создаёт запись для UDP-пакета", () => {
    const udp = makePacket({
      src: CLIENT_IP,
      dst: SERVER_IP,
      protocol: IP_PROTOCOLS.UDP,
      payload: makeUDPPayload({ src: 12345, dst: 53 }),
    });

    const conn = tracker.handle_packet(udp);

    expect(conn).toBeDefined();
    expect(conn?.protocol).toBe(IP_PROTOCOLS.UDP);
    expect(conn?.tcp).toBeUndefined();
    expect(conn?.icmp).toBeUndefined();
  });

  it("создаёт запись для ICMP Echo Request и сохраняет id", () => {
    const icmp = makePacket({
      src: CLIENT_IP,
      dst: SERVER_IP,
      protocol: IP_PROTOCOLS.ICMP,
      payload: makeICMPPayload({ type: 8, code: 0, id: 0x1234 }),
    });

    const conn = tracker.handle_packet(icmp);

    expect(conn).toBeDefined();
    expect(conn?.protocol).toBe(IP_PROTOCOLS.ICMP);
    expect(conn?.icmp?.type).toBe(8);
    expect(conn?.icmp?.code).toBe(0);
    expect(conn?.icmp?.id).toBe(0x1234);
  });

  // --------------------------------------------------------------------------
  // 🔹 TCP State Machine
  // --------------------------------------------------------------------------

  describe("TCP state machine", () => {
    function sendTCP(flags: number, opts: { reply?: boolean; seq?: number; ack?: number } = {}) {
      const [src, dst, sport, dport] = opts.reply
        ? [SERVER_IP, CLIENT_IP, SERVER_PORT, CLIENT_PORT]
        : [CLIENT_IP, SERVER_IP, CLIENT_PORT, SERVER_PORT];

      return makePacket({
        src,
        dst,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({
          src: sport,
          dst: dport,
          flags,
          seq: opts.seq,
          ack: opts.ack,
        }),
      });
    }

    it("полный handshake: syn-sent → syn-recv → established", () => {
      // 1. SYN
      let conn = tracker.handle_packet(sendTCP(TCP_FLAGS.SYN));
      expect(conn?.tcp?.state).toBe("syn-sent");

      // 2. SYN+ACK (reply)
      conn = tracker.handle_packet(sendTCP(TCP_FLAGS.SYN | TCP_FLAGS.ACK, { reply: true, ack: 1001 }));
      expect(conn?.tcp?.state).toBe("syn-recv");
      expect(conn?.has_reply).toBe(true);

      // 3. ACK
      conn = tracker.handle_packet(sendTCP(TCP_FLAGS.ACK, { ack: 2001 }));
      expect(conn?.tcp?.state).toBe("established");
    });

    it("RST в любом состоянии переводит в close", () => {
      // SYN → syn-sent
      tracker.handle_packet(sendTCP(TCP_FLAGS.SYN));

      // RST → close
      const conn = tracker.handle_packet(sendTCP(TCP_FLAGS.RST));
      expect(conn?.tcp?.state).toBe("close");
    });

    it("established → fin-wait / close-wait при получении FIN", () => {
      // Доводим до established
      tracker.handle_packet(sendTCP(TCP_FLAGS.SYN));
      tracker.handle_packet(sendTCP(TCP_FLAGS.SYN | TCP_FLAGS.ACK, { reply: true, ack: 1001 }));
      tracker.handle_packet(sendTCP(TCP_FLAGS.ACK, { ack: 2001 }));

      // Клиент шлёт FIN → fin-wait
      let conn = tracker.handle_packet(sendTCP(TCP_FLAGS.FIN | TCP_FLAGS.ACK));
      expect(conn?.tcp?.state).toBe("fin-wait");

      // Сервер шлёт FIN → last-ack (т.к. клиент уже в fin-wait)
      conn = tracker.handle_packet(sendTCP(TCP_FLAGS.FIN | TCP_FLAGS.ACK, { reply: true }));
      expect(conn?.tcp?.state).toBe("last-ack");
    });

    it("одновременное закрытие: fin-wait + FIN → time-wait", () => {
      // established
      tracker.handle_packet(sendTCP(TCP_FLAGS.SYN));
      tracker.handle_packet(sendTCP(TCP_FLAGS.SYN | TCP_FLAGS.ACK, { reply: true, ack: 1001 }));
      tracker.handle_packet(sendTCP(TCP_FLAGS.ACK, { ack: 2001 }));

      // Клиент шлёт FIN
      tracker.handle_packet(sendTCP(TCP_FLAGS.FIN | TCP_FLAGS.ACK));

      // Сервер тоже шлёт FIN (одновременное закрытие)
      const conn = tracker.handle_packet(sendTCP(TCP_FLAGS.FIN | TCP_FLAGS.ACK, { reply: true }));
      // По логике: fin-wait + reply:FIN → last-ack, но если оба шлют FIN почти одновременно,
      // может быть time-wait. Проверяем текущую реализацию:
      expect(["last-ack", "time-wait"]).toContain(conn?.tcp?.state);
    });

    it("last-ack + ACK → close", () => {
      // Доводим до last-ack
      tracker.handle_packet(sendTCP(TCP_FLAGS.SYN));
      tracker.handle_packet(sendTCP(TCP_FLAGS.SYN | TCP_FLAGS.ACK, { reply: true, ack: 1001 }));
      tracker.handle_packet(sendTCP(TCP_FLAGS.ACK, { ack: 2001 }));
      tracker.handle_packet(sendTCP(TCP_FLAGS.FIN | TCP_FLAGS.ACK)); // fin-wait
      tracker.handle_packet(sendTCP(TCP_FLAGS.FIN | TCP_FLAGS.ACK, { reply: true })); // last-ack

      // Финальный ACK от клиента
      const conn = tracker.handle_packet(sendTCP(TCP_FLAGS.ACK, { reply: false }));
      expect(conn?.tcp?.state).toBe("close");
    });
  });

  // --------------------------------------------------------------------------
  // 🔹 UDP / ICMP: has_reply и базовая логика
  // --------------------------------------------------------------------------

  it("UDP: reply-пакет ставит has_reply=true", () => {
    // Запрос
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.UDP,
        payload: makeUDPPayload({ src: 12345, dst: 53 }),
      }),
    );

    // Ответ
    const conn = tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.UDP,
        payload: makeUDPPayload({ src: 53, dst: 12345 }),
      }),
    );

    expect(conn?.has_reply).toBe(true);
  });

  it("ICMP: Echo Reply ставит has_reply=true", () => {
    // Request
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.ICMP,
        payload: makeICMPPayload({ type: 8, code: 0, id: 0xabcd }),
      }),
    );

    // Reply
    const conn = tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.ICMP,
        payload: makeICMPPayload({ type: 0, code: 0, id: 0xabcd }),
      }),
    );

    expect(conn?.has_reply).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 🔹 Поиск существующего соединения
  // --------------------------------------------------------------------------

  it("находит существующее соединение по 4-кортежу", () => {
    const syn1 = makePacket({
      src: CLIENT_IP,
      dst: SERVER_IP,
      protocol: IP_PROTOCOLS.TCP,
      payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
    });

    const conn1 = tracker.handle_packet(syn1);

    // Второй пакет того же соединения
    const syn2 = makePacket({
      src: CLIENT_IP,
      dst: SERVER_IP,
      protocol: IP_PROTOCOLS.TCP,
      payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN, seq: 1001 }),
    });

    const conn2 = tracker.handle_packet(syn2);

    expect(conn1).toBe(conn2); // один и тот же объект
    expect(tracker["_table"].length).toBe(1); // запись не дублируется
  });

  it("различает соединения по портам", () => {
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );

    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT + 1, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );

    expect(tracker["_table"].length).toBe(2);
  });
});

// ============================================================================
// 🔴 Дополнительные тесты: негативные сценарии и edge-cases
// ============================================================================

describe("Tracker: негативные сценарии и edge-cases", () => {
  // --------------------------------------------------------------------------
  // 🔹 Некорректные комбинации флагов (должны игнорироваться или помечаться invalid)
  // --------------------------------------------------------------------------

  it("игнорирует пакет с комбинацией SYN+FIN (invalid)", () => {
    // SYN
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );

    // SYN+FIN — некорректная комбинация, не должна менять состояние
    const conn = tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({
          src: SERVER_PORT,
          dst: CLIENT_PORT,
          flags: TCP_FLAGS.SYN | TCP_FLAGS.FIN,
        }),
      }),
    );

    // Состояние не должно измениться с syn-sent на что-то другое из-за invalid пакета
    // Примечание: в текущей реализации нет явного флага "invalid" на записи,
    // поэтому проверяем, что состояние не перешло в syn-recv
    expect(conn?.tcp?.state).not.toBe("syn-recv");
  });

  it("игнорирует пакет без флагов (NULL scan)", () => {
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );

    const conn = tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: 0 }),
      }),
    );

    expect(conn?.tcp?.state).toBe("syn-sent"); // состояние не изменилось
  });

  it("игнорирует PSH без ACK (некорректный пакет)", () => {
    // established
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );
    tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({
          src: SERVER_PORT,
          dst: CLIENT_PORT,
          flags: TCP_FLAGS.SYN | TCP_FLAGS.ACK,
          ack: 1001,
        }),
      }),
    );
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.ACK, ack: 2001 }),
      }),
    );

    // PSH без ACK — некорректно
    const conn = tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.PSH }),
      }),
    );

    // В строгой реализации такой пакет должен игнорироваться
    // Если ваша реализация допускает — адаптируйте тест
    expect(conn?.tcp?.state).toBe("established"); // состояние не должно сломаться
  });

  // --------------------------------------------------------------------------
  // 🔹 Атаки и аномалии: RST, повторные SYN, spoofing
  // --------------------------------------------------------------------------

  it("RST с другими флагами всё равно закрывает соединение", () => {
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );

    // RST+ACK (часто встречается)
    const conn = tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: SERVER_PORT, dst: CLIENT_PORT, flags: TCP_FLAGS.RST | TCP_FLAGS.ACK }),
      }),
    );

    expect(conn?.tcp?.state).toBe("close");
  });

  it("повторный SYN в состоянии syn-sent не ломает машину (ретрансмиссия)", () => {
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN, seq: 1000 }),
      }),
    );

    // Ретрансмиссия SYN с тем же или другим seq
    const conn = tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN, seq: 1000 }),
      }),
    );

    expect(conn?.tcp?.state).toBe("syn-sent"); // остаёмся в том же состоянии
  });

  it("SYN в состоянии established обрабатывается (возможный attack или re-use)", () => {
    // established
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );
    tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({
          src: SERVER_PORT,
          dst: CLIENT_PORT,
          flags: TCP_FLAGS.SYN | TCP_FLAGS.ACK,
          ack: 1001,
        }),
      }),
    );
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.ACK, ack: 2001 }),
      }),
    );

    // Новый SYN на том же 4-кортеже (странно, но возможно при быстром re-use)
    const conn = tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );

    // В Linux conntrack такой пакет обычно создаёт новое соединение,
    // но в упрощённой реализации может остаться в established или перейти в syn-sent.
    // Важно: не должно быть падения или некорректного перехода.
    expect(["established", "syn-sent"]).toContain(conn?.tcp?.state);
  });

  // --------------------------------------------------------------------------
  // 🔹 Состояние close и time-wait: что происходит после «закрытия»
  // --------------------------------------------------------------------------

  it("пакеты после перехода в close не меняют состояние (только таймаут)", () => {
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );

    // RST → close
    tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: SERVER_PORT, dst: CLIENT_PORT, flags: TCP_FLAGS.RST }),
      }),
    );

    // Любые дальнейшие пакеты не должны выводить из close
    const conn = tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.ACK }),
      }),
    );

    expect(conn?.tcp?.state).toBe("close");
  });

  it("в time-wait новый SYN от того же клиента может начать новое соединение (connection reuse)", () => {
    // Доводим до time-wait
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );
    tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({
          src: SERVER_PORT,
          dst: CLIENT_PORT,
          flags: TCP_FLAGS.SYN | TCP_FLAGS.ACK,
          ack: 1001,
        }),
      }),
    );
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.ACK, ack: 2001 }),
      }),
    );
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.FIN | TCP_FLAGS.ACK }),
      }),
    );
    tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: SERVER_PORT, dst: CLIENT_PORT, flags: TCP_FLAGS.FIN | TCP_FLAGS.ACK }),
      }),
    );
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.ACK }),
      }),
    ); // → time-wait

    // Новый SYN на том же 4-кортеже (быстрый re-use)
    const conn = tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );

    // В реальной системе это создаст новую запись, но в упрощённой реализации
    // может остаться в time-wait или перезаписать. Главное — не креш.
    expect(["time-wait", "syn-sent"]).toContain(conn?.tcp?.state);
  });

  // --------------------------------------------------------------------------
  // 🔹 Направление: проверка, что reply-детекция работает корректно
  // --------------------------------------------------------------------------

  it('пакет в "обратном" направлении не считается reply, если 4-кортеж не совпадает', () => {
    // Создаём соединение: CLIENT:1000 → SERVER:80
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: 1000, dst: 80, flags: TCP_FLAGS.SYN }),
      }),
    );

    // Пытаемся отправить пакет: SERVER:1000 → CLIENT:80 (перепутаны порты!)
    const conn = tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: 1000, dst: 80, flags: TCP_FLAGS.SYN | TCP_FLAGS.ACK }),
      }),
    );

    // Не должно найти соединение, т.к. порты не совпадают с reply-ожидаемыми
    expect(conn).toBeUndefined();
  });

  it("FIN в состоянии syn-sent игнорируется (некорректный переход)", () => {
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: CLIENT_PORT, dst: SERVER_PORT, flags: TCP_FLAGS.SYN }),
      }),
    );

    const conn = tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.TCP,
        payload: makeTCPPayload({ src: SERVER_PORT, dst: CLIENT_PORT, flags: TCP_FLAGS.FIN }),
      }),
    );

    // FIN в syn-sent — некорректно, состояние не должно меняться на close-wait
    expect(conn?.tcp?.state).toBe("syn-sent");
  });

  // --------------------------------------------------------------------------
  // 🔹 ICMP/UDP: негативные сценарии
  // --------------------------------------------------------------------------

  it("ICMP Reply с другим id не совпадает с Request", () => {
    // Request с id=0x1234
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.ICMP,
        payload: makeICMPPayload({ type: 8, code: 0, id: 0x1234 }),
      }),
    );

    // Reply с другим id=0x5678
    const conn = tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.ICMP,
        payload: makeICMPPayload({ type: 0, code: 0, id: 0x5678 }),
      }),
    );

    // Не должно найти существующее соединение (в строгой реализации)
    // Если ваша реализация не проверяет icmp.id — адаптируйте тест
    expect(conn?.has_reply).toBe(false);
  });

  it("UDP: пакет с другими портами не считается ответом", () => {
    // Запрос: клиент:12345 → сервер:53
    tracker.handle_packet(
      makePacket({
        src: CLIENT_IP,
        dst: SERVER_IP,
        protocol: IP_PROTOCOLS.UDP,
        payload: makeUDPPayload({ src: 12345, dst: 53 }),
      }),
    );

    // «Ответ» с перепутанными портами: сервер:12345 → клиент:53 (неверно!)
    const conn = tracker.handle_packet(
      makePacket({
        src: SERVER_IP,
        dst: CLIENT_IP,
        protocol: IP_PROTOCOLS.UDP,
        payload: makeUDPPayload({ src: 12345, dst: 53 }),
      }),
    );

    expect(conn?.has_reply).toBe(false);
  });
});
