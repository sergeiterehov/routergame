import { observer } from "mobx-react-lite";
import { store } from "./state/store";
import {
  ARP_OPCODES,
  DHCP_OPS,
  ETHER_TYPES,
  ICMP_TYPES,
  IP_BROADCAST,
  IP_PROTOCOLS,
  MAC_BROADCAST,
  TCP_FLAGS,
} from "./devices/pack";
import { formatValue, hexdump } from "./devices/format";
import { from_utf8 } from "./devices/apps/app.lib";

const _head_row = (
  <tr>
    <th></th>
    <td>Datetime</td>
    <td>Src node</td>
    <td>Dst node</td>
    <td>Analyzer</td>
    <th>Size</th>
  </tr>
);

function _fast_analyze(data: Uint8Array): string[] {
  if (data.length < 14) return ["unknown"];

  const res: string[] = [];

  const $ = new DataView(data.buffer, data.byteOffset);
  const mac_dst = $.getBigUint64(0) >> 16n;
  const eth_type = $.getUint16(12);

  if (mac_dst === MAC_BROADCAST) {
    res.push("Broadcast");
  }

  if (eth_type === ETHER_TYPES.ARP) {
    res.push("ARP");
    const op = $.getUint16(20);
    if (op === ARP_OPCODES.REQUEST) {
      res.push("Request");
    } else if (op === ARP_OPCODES.REPLY) {
      res.push("Reply");
    }
  } else if (eth_type === ETHER_TYPES.IPv4) {
    res.push("IPv4");
    const ip_dst = $.getUint32(30);

    if (ip_dst === IP_BROADCAST) {
      res.push("IP Broadcast");
    }

    const protocol = $.getUint8(23);
    if (protocol === IP_PROTOCOLS.ICMP) {
      res.push("ICMP");

      const type = $.getUint8(34);

      if (type === ICMP_TYPES.ECHO_REQUEST) {
        res.push("Ping");
      } else if (type === ICMP_TYPES.ECHO_REPLY) {
        res.push("Pong");
      } else if (type === ICMP_TYPES.TIME_EXCEEDED) {
        res.push("TTL");
      } else if (type === ICMP_TYPES.DEST_UNREACHABLE) {
        res.push("Unreachable");
      }
    } else if (protocol === IP_PROTOCOLS.UDP) {
      res.push("UDP");

      const port_src = $.getUint16(34);
      const port_dst = $.getUint16(36);

      if (port_dst === 53 || port_src === 53) {
        res.push("DNS");

        const a_count = $.getUint16(48);

        if (a_count > 0) {
          res.push("Answer");
        } else {
          res.push("Question");
        }
      } else if (port_src === 67 || port_dst === 67 || port_src === 68 || port_dst === 68) {
        res.push("DHCP");

        const type = $.getUint8(42);

        if (type === DHCP_OPS.REQUEST) {
          res.push("Request");
        } else if (type === DHCP_OPS.REPLY) {
          res.push("Reply");
        }
      }
    } else if (protocol === IP_PROTOCOLS.TCP) {
      res.push("TCP");

      const flags = $.getUint16(46);
      if (flags & TCP_FLAGS.SYN) {
        res.push("SYN");
      }
      if (flags & TCP_FLAGS.ACK) {
        res.push("ACK");

        const payload = data.subarray(54);

        if (from_utf8(payload.subarray(0, 10)).startsWith("HTTP")) {
          res.push("HTTP");
        }
      }
      if (flags & TCP_FLAGS.FIN) {
        res.push("FIN");
      }
      if (flags & TCP_FLAGS.RST) {
        res.push("RST");
      }
    }
  }

  return res;
}

export const ExchangeJournal = observer(function ExchangeJournal() {
  const { exchange_journal } = store;

  const nodesMap = new Map(store.arch.node.map((n) => [n.id, n]));

  return (
    <dialog
      open
      className="modal"
      onClose={(e) => {
        e.preventDefault();
        e.stopPropagation();
        store.exchange_close();
      }}
    >
      <div className="modal-box w-screen h-screen max-w-full max-h-none rounded-none p-8 flex flex-col">
        <h3 className="font-bold text-lg">Exchange Journal</h3>
        <div className="overflow-x-auto">
          <table className="table table-xs table-pin-rows table-pin-cols">
            <thead>{_head_row}</thead>
            <tbody>
              {exchange_journal.toReversed().map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{new Date(item.created_at).toISOString()}</td>
                  <td>{nodesMap.get(item.a_id)?.name}</td>
                  <td>{nodesMap.get(item.b_id)?.name}</td>
                  <td
                    className="link link-hover"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      navigator.clipboard.writeText(hexdump(item.data));
                      alert("Copied");
                    }}
                  >
                    {_fast_analyze(item.data).join(", ")}
                  </td>
                  <td>{`${formatValue(item.data.byteLength)}B`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>{_head_row}</tfoot>
          </table>
        </div>
        <div className="modal-action">
          <button
            className="btn btn-error btn-outline"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm("Are you sure?")) {
                store.exchange_clear();
              }
            }}
          >
            Clear all
          </button>
          <div className="grow" />
          <form method="dialog">
            <button className="btn">Close</button>
          </form>
        </div>
      </div>
    </dialog>
  );
});
