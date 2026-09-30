import { unwrapPgQuery } from "./idempotency.store";

describe("unwrapPgQuery", () => {
  it("reads INSERT/SELECT rows and UPDATE [rows, count]", () => {
    expect(unwrapPgQuery([{ status: "pending" }])).toEqual([{ status: "pending" }]);
    expect(
      unwrapPgQuery([[{ status: "pending", idempotency_key: "k" }], 1]),
    ).toEqual([{ status: "pending", idempotency_key: "k" }]);
    expect(unwrapPgQuery([[], 0])).toEqual([]);
  });
});
