import { describe, expect, it } from "vitest";
import { pack_ethernet_frame, unpack_ethernet_frame, type TEthernetFrame } from "./pack";
import { hexdump, parse_hexdump } from "./format";

describe("ethernet", () => {
  it("should pack/unpack untagged", () => {
    const obj: TEthernetFrame = {
      dst: 0x010203040506n,
      src: 0x060504030201n,
      etherType: 0x0800,
      payload: new Uint8Array([1, 2, 3, 4]),
    };
    const hex = "01 02 03 04 05 06 06 05 04 03 02 01 08 00 01 02 03 04";

    expect(hexdump(pack_ethernet_frame(obj))).toBe(hex);
    expect(unpack_ethernet_frame(parse_hexdump(hex))).toEqual(obj);
  });

  it("should pack/unpack tagged", () => {
    const obj: TEthernetFrame = {
      dst: 0x010203040506n,
      src: 0x060504030201n,
      tag: {
        pcp: 2,
        dei: 1,
        vid: 0x123,
      },
      etherType: 0x0800,
      payload: new Uint8Array([1, 2, 3, 4]),
    };
    const hex = "01 02 03 04 05 06 06 05 04 03 02 01 81 00 51 23 08 00 01 02 03 04";

    expect(hexdump(pack_ethernet_frame(obj))).toBe(hex);
    expect(unpack_ethernet_frame(parse_hexdump(hex))).toEqual(obj);
  });
});
