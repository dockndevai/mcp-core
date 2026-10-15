import { afterEach, describe, expect, it } from "vitest";
import { envBool, envEnum, envList, envNum } from "../src/env.js";

const KEYS = ["T_BOOL", "T_LIST", "T_NUM", "T_ENUM"];
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("envBool", () => {
  it("parses truthy strings, defaults when unset", () => {
    for (const v of ["1", "true", "YES", "on", "On"]) {
      process.env.T_BOOL = v;
      expect(envBool("T_BOOL")).toBe(true);
    }
    process.env.T_BOOL = "0";
    expect(envBool("T_BOOL")).toBe(false);
    delete process.env.T_BOOL;
    expect(envBool("T_BOOL")).toBe(false);
    expect(envBool("T_BOOL", true)).toBe(true);
  });
});

describe("envList", () => {
  it("splits CSV, trims, drops empties", () => {
    process.env.T_LIST = " a , b ,,c ";
    expect(envList("T_LIST")).toEqual(["a", "b", "c"]);
    delete process.env.T_LIST;
    expect(envList("T_LIST")).toEqual([]);
  });
});

describe("envNum", () => {
  it("parses positive numbers, defaults otherwise", () => {
    process.env.T_NUM = "42";
    expect(envNum("T_NUM", 10)).toBe(42);
    process.env.T_NUM = "-5";
    expect(envNum("T_NUM", 10)).toBe(10);
    process.env.T_NUM = "nope";
    expect(envNum("T_NUM", 10)).toBe(10);
  });
});

describe("envEnum", () => {
  it("accepts a known value (case-insensitive), defaults otherwise", () => {
    process.env.T_ENUM = "Read-Write";
    expect(envEnum("T_ENUM", ["read-only", "read-write", "admin"] as const, "read-only")).toBe("read-write");
    process.env.T_ENUM = "bogus";
    expect(envEnum("T_ENUM", ["read-only", "read-write", "admin"] as const, "read-only")).toBe("read-only");
  });
});
