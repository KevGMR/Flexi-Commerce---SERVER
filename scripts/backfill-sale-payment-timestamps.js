require("dotenv").config();
const mongoose = require("mongoose");

const Sale = require("../models/Sale");
const Receivable = require("../models/Receivable");

const hasFlag = (flag) => process.argv.includes(flag);

const toMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const normalizeStatus = (status) => status || "completed";

const paymentSignature = (payment = {}) => {
  const method = payment.method || "";
  const amount = toMoney(payment.amount);
  const reference = payment.reference || "";
  const status = normalizeStatus(payment.status);
  return `${method}|${amount}|${reference}|${status}`;
};

const toDateOrNull = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const matchTimestampForSalePayment = ({ salePayment, receivablePayments, usedIndices, fallback }) => {
  const expectedSignature = paymentSignature(salePayment);

  for (let index = 0; index < receivablePayments.length; index += 1) {
    if (usedIndices.has(index)) {
      continue;
    }

    const candidate = receivablePayments[index];
    if (paymentSignature(candidate) !== expectedSignature) {
      continue;
    }

    usedIndices.add(index);
    return toDateOrNull(candidate.collectedAt) || fallback;
  }

  for (let index = 0; index < receivablePayments.length; index += 1) {
    if (usedIndices.has(index)) {
      continue;
    }

    const candidate = receivablePayments[index];
    const amountMatches = toMoney(candidate.amount) === toMoney(salePayment.amount);
    const methodMatches = (candidate.method || "") === (salePayment.method || "");

    if (!amountMatches || !methodMatches) {
      continue;
    }

    usedIndices.add(index);
    return toDateOrNull(candidate.collectedAt) || fallback;
  }

  return fallback;
};

async function main() {
  const apply = hasFlag("--apply");
  const dryRun = !apply || hasFlag("--dry-run");

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const stats = {
    receivablesScanned: 0,
    salesMissing: 0,
    salesWithoutPayments: 0,
    salesAlreadyComplete: 0,
    salesPatched: 0,
    paymentEntriesPatched: 0,
    fallbackTimestampsUsed: 0,
  };

  const cursor = Receivable.find({
    payments: { $exists: true, $ne: [] },
  })
    .select("saleId payments lastPaymentAt createdAt")
    .lean()
    .cursor();

  for await (const receivable of cursor) {
    stats.receivablesScanned += 1;

    if (!receivable.saleId) {
      continue;
    }

    const sale = await Sale.findById(receivable.saleId).select("payments createdAt");

    if (!sale) {
      stats.salesMissing += 1;
      continue;
    }

    if (!Array.isArray(sale.payments) || sale.payments.length === 0) {
      stats.salesWithoutPayments += 1;
      continue;
    }

    const missingIndices = sale.payments
      .map((payment, index) => ({ payment, index }))
      .filter(({ payment }) => !payment.paidAt)
      .map(({ index }) => index);

    if (missingIndices.length === 0) {
      stats.salesAlreadyComplete += 1;
      continue;
    }

    const fallbackTimestamp =
      toDateOrNull(receivable.lastPaymentAt) ||
      toDateOrNull(sale.createdAt) ||
      toDateOrNull(receivable.createdAt) ||
      new Date();

    const receivablePayments = Array.isArray(receivable.payments)
      ? receivable.payments
      : [];
    const usedIndices = new Set();

    for (const index of missingIndices) {
      const salePayment = sale.payments[index];
      const matchedTimestamp = matchTimestampForSalePayment({
        salePayment,
        receivablePayments,
        usedIndices,
        fallback: fallbackTimestamp,
      });

      const usedFallback = !receivablePayments.some(
        (p) => toDateOrNull(p.collectedAt)?.getTime() === matchedTimestamp.getTime(),
      );

      if (usedFallback) {
        stats.fallbackTimestampsUsed += 1;
      }

      sale.payments[index].paidAt = matchedTimestamp;
      stats.paymentEntriesPatched += 1;
    }

    stats.salesPatched += 1;

    if (!dryRun) {
      await sale.save();
    }
  }

  console.log("\nBackfill sale payment timestamps summary");
  console.table(stats);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);

  await mongoose.disconnect();
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Backfill failed:", error.message);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.error("Failed to disconnect cleanly:", disconnectError.message);
    }
    process.exit(1);
  });
