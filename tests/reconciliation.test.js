const reconController = require("../controllers/Reconciliation");

describe("Reconciliation toDateRange helper", () => {
  test("date-only start/end produce a full-day window (86399999 ms)", () => {
    const { start, end } = reconController.toDateRange({ startDate: "2026-05-23", endDate: "2026-05-23" });
    const diff = end.getTime() - start.getTime();
    expect(diff).toBe(86399999); // 24h in ms minus 1
  });
});
