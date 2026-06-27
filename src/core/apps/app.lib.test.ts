import { describe, expect, it } from "vitest";
import { parse_args } from "./app.lib";

describe("Arguments parsing", () => {
  it("should parse arguments correctly", () => {
    expect(
      parse_args(
        [
          { name: "-v", type: "flag" },
          { name: "--if", type: "string", multiple: true },
          { name: "--ip", type: "ip", default: ["8.8.8.8"] },
          { name: "--proto", type: ["tcp", "udp"] },
        ],
        ["-v", "--if", "eth0", "--if", "eth1", "--proto", "udp"],
      ),
    ).toEqual({ v: ["1"], if: ["eth0", "eth1"], ip: ["8.8.8.8"], proto: ["udp"] });
  });

  it("should throw error for unknown argument", () => {
    expect(() => {
      parse_args([{ name: "-v", type: "flag" }], ["-x"]);
    }).toThrow();
  });

  it("should throw error for ambiguous argument", () => {
    expect(() => {
      parse_args(
        [
          { name: "-v", type: "flag" },
          { name: "-v", type: "flag" },
        ],
        ["-v"],
      );
    }).toThrow();
  });

  it("should throw error for missing value", () => {
    expect(() => {
      parse_args(
        [
          { name: "-v", type: "flag" },
          { name: "--ip", type: "ip" },
        ],
        ["--ip"],
      );
    }).toThrow();
  });

  it("should throw error for invalid value", () => {
    expect(() => {
      parse_args([{ name: "--ip", type: "ip" }], ["--ip", "invalid"]);
    }).toThrow();
  });

  it("should throw error for invalid flag", () => {
    expect(() => {
      parse_args([{ name: "-v", type: "flag" }], ["-v", "invalid"]);
    }).toThrow();
  });

  it("should throw error for invalid enum", () => {
    expect(() => {
      parse_args([{ name: "-a", type: ["ABC"] }], ["-a", "xyz"]);
    }).toThrow();
  });

  it("should name arguments correctly", () => {
    expect(parse_args([{ name: "--verbose", type: "flag" }], ["--verbose"])).toEqual({ verbose: ["1"] });
    expect(parse_args([{ name: "--verbose", alias: "-v", type: "flag" }], ["-v"])).toEqual({ verbose: ["1"] });
    expect(
      parse_args(
        [
          { type: "ip", required: true },
          { type: "number", required: true },
          { name: "-v", type: "flag" },
        ],
        ["-v", "8.8.8.8", "80"],
      ),
    ).toEqual({ v: ["1"], 0: ["8.8.8.8"], 1: ["80"] });
  });
});
