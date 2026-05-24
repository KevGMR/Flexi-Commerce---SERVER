require("dotenv").config();
const mongoose = require("mongoose");

const Sale = require("../models/Sale");

const hasFlag = (flag) => process.argv.includes(flag);

const getArgValue = (flag) => {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    return null;
  }

  return value;
};

const parseIntegerArg = ({ value, name, min, max }) => {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }

  if (typeof min === "number" && parsed < min) {
    throw new Error(`${name} must be >= ${min}`);
  }

  if (typeof max === "number" && parsed > max) {
    throw new Error(`${name} must be <= ${max}`);
  }

  return parsed;
};

const daysInUtcMonth = (year, monthOneBased) =>
  new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();

const parseDateParts = ({ dayRaw, monthRaw, yearRaw }) => {
  const day = parseIntegerArg({ value: dayRaw, name: "--day", min: 1, max: 31 });
  const month = parseIntegerArg({ value: monthRaw, name: "--month", min: 1, max: 12 });
  const year = parseIntegerArg({ value: yearRaw, name: "--year", min: 1970, max: 9999 });

  const maxDayForMonth = daysInUtcMonth(year, month);
  if (day > maxDayForMonth) {
    throw new Error(
      `--day is invalid for --month/--year combination. Max day for ${month}/${year} is ${maxDayForMonth}`,
    );
  }

  return { day, month, year };
};

const buildUtcDayRange = ({ day, month, year }) => {
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  return { start, end };
};

const pad2 = (value) => String(value).padStart(2, "0");
const pad3 = (value) => String(value).padStart(3, "0");

const formatUtc = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "invalid-date";
  }

  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}T${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}:${pad2(value.getUTCSeconds())}.${pad3(value.getUTCMilliseconds())}+00:00`;
};

const toAmountNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatAmount = (value) => toAmountNumber(value).toFixed(2);

const logUsage = () => {
  console.log("\nUsage:");
  console.log(
    "node scripts/list-sales-by-day.js --day <1-31> --month <1-12> --year <yyyy> [--limit <positive-integer>]",
  );
  console.log("\nNotes:");
  console.log("- Date is interpreted in UTC day boundaries.");
  console.log("- Query field is Sale.createdAt.");
  console.log("- Default limit is 500 rows.");
};

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    logUsage();
    return;
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set");
  }

  const dayRaw = getArgValue("--day");
  const monthRaw = getArgValue("--month");
  const yearRaw = getArgValue("--year");
  const limitRaw = getArgValue("--limit");

  const dateParts = parseDateParts({ dayRaw, monthRaw, yearRaw });
  const limit = limitRaw
    ? parseIntegerArg({
      value: limitRaw,
      name: "--limit",
      min: 1,
      max: 10000,
    })
    : 500;

  const { start, end } = buildUtcDayRange(dateParts);

  await mongoose.connect(process.env.MONGO_URI);

  const sales = await Sale.find({
    createdAt: {
      $gte: start,
      $lte: end,
    },
  })
    .select("_id createdAt customerName receiptNumber totalAmount paymentMethod paymentStatus status")
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  const saleIds = sales.map((sale) => String(sale._id));
  const totalAmount = sales.reduce((sum, sale) => sum + toAmountNumber(sale.totalAmount), 0);

  console.log("\nSales Pull By Day (UTC)");
  console.log(`Input Date (UTC): ${pad2(dateParts.day)}/${pad2(dateParts.month)}/${dateParts.year}`);
  console.log(`UTC Range Start: ${formatUtc(start)}`);
  console.log(`UTC Range End:   ${formatUtc(end)}`);
  console.log(`Returned Rows: ${sales.length}`);
  console.log(`Sale IDs: ${JSON.stringify(saleIds)}`);
  console.log(`Total Amount (returned rows): ${formatAmount(totalAmount)}`);

  if (sales.length === 0) {
    console.log("No sales found for the provided day.");
    return;
  }

  console.table(
    sales.map((sale) => ({
      id: String(sale._id),
      createdAt: formatUtc(sale.createdAt),
      customer: sale.customerName || "-",
      receipt: sale.receiptNumber || "-",
      amount: formatAmount(sale.totalAmount),
      paymentMethod: sale.paymentMethod || "-",
      paymentStatus: sale.paymentStatus || "-",
      status: sale.status || "-",
    })),
  );
}

main()
  .then(async () => {
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.error("Failed to disconnect cleanly:", disconnectError.message);
    }
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Sales pull failed:", error.message);
    logUsage();
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.error("Failed to disconnect cleanly:", disconnectError.message);
    }
    process.exit(1);
  });
