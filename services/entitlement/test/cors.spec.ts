import { corsOriginOption, parseCorsOrigins } from "../src/common/cors";

describe("CORS allowlist", () => {
  it("treats empty production config as closed", () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins("")).toEqual([]);
    expect(parseCorsOrigins("  ,  ")).toEqual([]);
    expect(corsOriginOption([])).toBe(false);
  });

  it("allows only listed console origins", () => {
    const origins = parseCorsOrigins("http://localhost:3050, http://127.0.0.1:3050");
    expect(corsOriginOption(origins)).toEqual(["http://localhost:3050", "http://127.0.0.1:3050"]);
    expect(corsOriginOption(origins)).not.toContain("http://evil.example");
  });
});
