require("dotenv").config();
const mongoose = require("mongoose");

const Sale = require("../models/Sale");
const Receivable = require("../models/Receivable");
const DeliveryFee = require("../models/DeliveryFee");

const hasFlag = (flag) => process.argv.includes(flag);

// Replace these with the sale IDs you want to inspect.
const saleIds = [
  "69dde3edc9076cdc1b40e440", "69dde42ac9076cdc1b40e46d", "69dde566c9076cdc1b40e4c3", "69dde810c9076cdc1b40e554", "69dde8a2c9076cdc1b40e58b", "69dde8f7c9076cdc1b40e5c4", "69ddf0dfc9076cdc1b40e81e"
];

// Change this value to control the backdated day of the month.
const targetDayOfMonth = 10;

const DATE_DETAIL_SEPARATOR = " | ";

const formatUtc = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "invalid-date";
  }

  const pad2 = (input) => String(input).padStart(2, "0");
  const pad3 = (input) => String(input).padStart(3, "0");

  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}T${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}:${pad2(value.getUTCSeconds())}.${pad3(value.getUTCMilliseconds())}+00:00`;
};

const normalizeSaleId = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !mongoose.Types.ObjectId.isValid(trimmed)) {
    return null;
  }

  return trimmed;
};

const toDateOrNull = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const daysInUtcMonth = (year, monthOneBased) =>
  new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();

const backdatePreserveUtcTime = (value, dayOfMonth) => {
  const originalDate = toDateOrNull(value);
  if (!originalDate) {
    return null;
  }

  const maxDay = daysInUtcMonth(
    originalDate.getUTCFullYear(),
    originalDate.getUTCMonth() + 1,
  );
  const safeDay = Math.min(Math.max(dayOfMonth, 1), maxDay);

  return new Date(
    Date.UTC(
      originalDate.getUTCFullYear(),
      originalDate.getUTCMonth(),
      safeDay,
      originalDate.getUTCHours(),
      originalDate.getUTCMinutes(),
      originalDate.getUTCSeconds(),
      originalDate.getUTCMilliseconds(),
    ),
  );
};

const formatChange = (before, after) => `${formatUtc(before)} -> ${formatUtc(after)}`;

const applyScalarDateShift = ({ source, target, fieldName, targetDayOfMonth, details }) => {
  const original = toDateOrNull(source?.[fieldName]);
  if (!original) {
    return 0;
  }

  const shifted = backdatePreserveUtcTime(original, targetDayOfMonth);
  if (!shifted || shifted.getTime() === original.getTime()) {
    return 0;
  }

  target[fieldName] = shifted;
  details.push(`${fieldName}: ${formatChange(original, shifted)}`);
  return 1;
};

const applyArrayDateShift = ({
  sourceArray,
  dateField,
  collectionLabel,
  targetDayOfMonth,
  details,
}) => {
  if (!Array.isArray(sourceArray) || sourceArray.length === 0) {
    return { changedCount: 0, updatedArray: sourceArray };
  }

  let changedCount = 0;
  const updatedArray = sourceArray.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return entry;
    }

    const original = toDateOrNull(entry[dateField]);
    if (!original) {
      return entry;
    }

    const shifted = backdatePreserveUtcTime(original, targetDayOfMonth);
    if (!shifted || shifted.getTime() === original.getTime()) {
      return entry;
    }

    changedCount += 1;
    details.push(
      `${collectionLabel}[${index}].${dateField}: ${formatChange(original, shifted)}`,
    );

    return {
      ...entry,
      [dateField]: shifted,
    };
  });

  return { changedCount, updatedArray };
};

const groupBySaleId = (docs) => {
  const grouped = new Map();

  for (const doc of docs) {
    const saleId = String(doc?.saleId || "");
    if (!saleId) {
      continue;
    }

    const existing = grouped.get(saleId) || [];
    existing.push(doc);
    grouped.set(saleId, existing);
  }

  return grouped;
};

const buildSaleUpdateCandidate = ({ sale, targetDayOfMonth }) => {
  const details = [];
  const set = {};
  let changedCount = 0;

  changedCount += applyScalarDateShift({
    source: sale,
    target: set,
    fieldName: "createdAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: sale,
    target: set,
    fieldName: "updatedAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: sale,
    target: set,
    fieldName: "completedAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: sale,
    target: set,
    fieldName: "voidedAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: sale,
    target: set,
    fieldName: "refundedAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: sale,
    target: set,
    fieldName: "deliveryStatusSyncedAt",
    targetDayOfMonth,
    details,
  });

  const shiftedPayments = applyArrayDateShift({
    sourceArray: sale.payments,
    dateField: "paidAt",
    collectionLabel: "payments",
    targetDayOfMonth,
    details,
  });
  if (shiftedPayments.changedCount > 0) {
    set.payments = shiftedPayments.updatedArray;
    changedCount += shiftedPayments.changedCount;
  }

  const shiftedPaymentCorrections = applyArrayDateShift({
    sourceArray: sale.paymentCorrections,
    dateField: "correctedAt",
    collectionLabel: "paymentCorrections",
    targetDayOfMonth,
    details,
  });
  if (shiftedPaymentCorrections.changedCount > 0) {
    set.paymentCorrections = shiftedPaymentCorrections.updatedArray;
    changedCount += shiftedPaymentCorrections.changedCount;
  }

  const shiftedRefundHistory = applyArrayDateShift({
    sourceArray: sale.refundHistory,
    dateField: "refundedAt",
    collectionLabel: "refundHistory",
    targetDayOfMonth,
    details,
  });
  if (shiftedRefundHistory.changedCount > 0) {
    set.refundHistory = shiftedRefundHistory.updatedArray;
    changedCount += shiftedRefundHistory.changedCount;
  }

  const shiftedInventoryUpdates = applyArrayDateShift({
    sourceArray: sale.inventoryUpdates,
    dateField: "timestamp",
    collectionLabel: "inventoryUpdates",
    targetDayOfMonth,
    details,
  });
  if (shiftedInventoryUpdates.changedCount > 0) {
    set.inventoryUpdates = shiftedInventoryUpdates.updatedArray;
    changedCount += shiftedInventoryUpdates.changedCount;
  }

  const shiftedShopifySyncLog = applyArrayDateShift({
    sourceArray: sale.shopifySyncLog,
    dateField: "timestamp",
    collectionLabel: "shopifySyncLog",
    targetDayOfMonth,
    details,
  });
  if (shiftedShopifySyncLog.changedCount > 0) {
    set.shopifySyncLog = shiftedShopifySyncLog.updatedArray;
    changedCount += shiftedShopifySyncLog.changedCount;
  }

  if (changedCount === 0) {
    return null;
  }

  return {
    saleId: String(sale._id),
    _id: sale._id,
    model: "Sale",
    set,
    changedCount,
    details,
  };
};

const buildReceivableUpdateCandidate = ({ receivable, targetDayOfMonth }) => {
  const details = [];
  const set = {};
  let changedCount = 0;

  changedCount += applyScalarDateShift({
    source: receivable,
    target: set,
    fieldName: "createdAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: receivable,
    target: set,
    fieldName: "updatedAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: receivable,
    target: set,
    fieldName: "lastPaymentAt",
    targetDayOfMonth,
    details,
  });

  const shiftedPayments = applyArrayDateShift({
    sourceArray: receivable.payments,
    dateField: "collectedAt",
    collectionLabel: "payments",
    targetDayOfMonth,
    details,
  });
  if (shiftedPayments.changedCount > 0) {
    set.payments = shiftedPayments.updatedArray;
    changedCount += shiftedPayments.changedCount;
  }

  const shiftedPaymentCorrections = applyArrayDateShift({
    sourceArray: receivable.paymentCorrections,
    dateField: "correctedAt",
    collectionLabel: "paymentCorrections",
    targetDayOfMonth,
    details,
  });
  if (shiftedPaymentCorrections.changedCount > 0) {
    set.paymentCorrections = shiftedPaymentCorrections.updatedArray;
    changedCount += shiftedPaymentCorrections.changedCount;
  }

  if (changedCount === 0) {
    return null;
  }

  return {
    saleId: String(receivable.saleId),
    _id: receivable._id,
    model: "Receivable",
    set,
    changedCount,
    details,
  };
};

const buildDeliveryFeeUpdateCandidate = ({ deliveryFee, targetDayOfMonth }) => {
  const details = [];
  const set = {};
  let changedCount = 0;

  changedCount += applyScalarDateShift({
    source: deliveryFee,
    target: set,
    fieldName: "createdAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: deliveryFee,
    target: set,
    fieldName: "updatedAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: deliveryFee,
    target: set,
    fieldName: "assignedAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: deliveryFee,
    target: set,
    fieldName: "pickedUpAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: deliveryFee,
    target: set,
    fieldName: "deliveredAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: deliveryFee,
    target: set,
    fieldName: "cancelledAt",
    targetDayOfMonth,
    details,
  });
  changedCount += applyScalarDateShift({
    source: deliveryFee,
    target: set,
    fieldName: "actualDelivery",
    targetDayOfMonth,
    details,
  });

  if (changedCount === 0) {
    return null;
  }

  return {
    saleId: String(deliveryFee.saleId),
    _id: deliveryFee._id,
    model: "DeliveryFee",
    set,
    changedCount,
    details,
  };
};

const summarizeCandidateDetails = (candidates, withDocId = false) => {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "none";
  }

  const allDetails = [];
  for (const candidate of candidates) {
    const docPrefix = withDocId ? `[${String(candidate._id)}] ` : "";
    for (const detail of candidate.details || []) {
      allDetails.push(`${docPrefix}${detail}`);
    }
  }

  return allDetails.length > 0 ? allDetails.join(DATE_DETAIL_SEPARATOR) : "none";
};

const countCandidateChanges = (candidates) =>
  (Array.isArray(candidates) ? candidates : []).reduce(
    (sum, candidate) => sum + (Number(candidate.changedCount) || 0),
    0,
  );

const buildBulkOps = (candidates) =>
  candidates.map((candidate) => ({
    updateOne: {
      filter: { _id: candidate._id },
      update: { $set: candidate.set },
    },
  }));

const executeBulkOps = async ({ model, ops, writeEnabled }) => {
  if (!writeEnabled || !Array.isArray(ops) || ops.length === 0) {
    return 0;
  }

  const result = await model.collection.bulkWrite(ops, { ordered: false });
  return result.modifiedCount || 0;
};

const toAmountString = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "0.00";
  }

  return parsed.toFixed(2);
};

const formatPaymentsBreakdown = (sale) => {
  const paymentEntries = Array.isArray(sale?.payments)
    ? sale.payments
      .map((payment) => {
        const method = payment?.method || "unknown";
        const amount = toAmountString(payment?.amount);
        const status = payment?.status || "unknown";
        return `${method}:${amount}:${status}`;
      })
      .filter(Boolean)
    : [];

  if (paymentEntries.length > 0) {
    return paymentEntries.join(" | ");
  }

  if (sale?.paymentMethod) {
    const amount = toAmountString(sale?.totalAmount);
    const status = sale?.paymentStatus || "unknown";
    return `${sale.paymentMethod}:${amount}:${status}`;
  }

  return "none";
};

async function main() {
  const apply = hasFlag("--apply");
  const dryRun = !apply || hasFlag("--dry-run");
  const writeEnabled = apply && !dryRun;

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set");
  }

  const normalizedSaleIds = saleIds
    .map(normalizeSaleId)
    .filter(Boolean);

  const invalidSaleIds = saleIds.filter((value) => normalizeSaleId(value) === null);

  if (normalizedSaleIds.length === 0) {
    console.log("No valid sale IDs were provided.");
    if (invalidSaleIds.length > 0) {
      console.log("\nInvalid sale IDs:");
      console.table(invalidSaleIds.map((saleId) => ({ saleId })));
    }
    return;
  }

  await mongoose.connect(process.env.MONGO_URI);

  const uniqueSaleIds = [...new Set(normalizedSaleIds)];
  const sales = await Sale.find({ _id: { $in: uniqueSaleIds } })
    .select(
      "_id createdAt updatedAt completedAt voidedAt refundedAt deliveryStatusSyncedAt payments paymentCorrections refundHistory inventoryUpdates shopifySyncLog paymentMethod totalAmount paymentStatus",
    )
    .lean();

  const receivables = await Receivable.find({ saleId: { $in: uniqueSaleIds } })
    .select(
      "_id saleId createdAt updatedAt lastPaymentAt payments paymentCorrections",
    )
    .lean();

  const deliveryFees = await DeliveryFee.find({ saleId: { $in: uniqueSaleIds } })
    .select(
      "_id saleId createdAt updatedAt assignedAt pickedUpAt deliveredAt cancelledAt actualDelivery",
    )
    .lean();

  const salesById = new Map(
    sales.map((sale) => [String(sale._id), sale]),
  );

  const receivablesBySaleId = groupBySaleId(receivables);
  const deliveryFeesBySaleId = groupBySaleId(deliveryFees);

  const saleCandidatesBySaleId = new Map();
  const receivableCandidatesBySaleId = new Map();
  const deliveryCandidatesBySaleId = new Map();

  const saleCandidates = [];
  for (const sale of sales) {
    const candidate = buildSaleUpdateCandidate({ sale, targetDayOfMonth });
    if (!candidate) {
      continue;
    }

    saleCandidates.push(candidate);
    saleCandidatesBySaleId.set(candidate.saleId, candidate);
  }

  const receivableCandidates = [];
  for (const receivable of receivables) {
    const candidate = buildReceivableUpdateCandidate({
      receivable,
      targetDayOfMonth,
    });
    if (!candidate) {
      continue;
    }

    receivableCandidates.push(candidate);
    const existing = receivableCandidatesBySaleId.get(candidate.saleId) || [];
    existing.push(candidate);
    receivableCandidatesBySaleId.set(candidate.saleId, existing);
  }

  const deliveryFeeCandidates = [];
  for (const deliveryFee of deliveryFees) {
    const candidate = buildDeliveryFeeUpdateCandidate({
      deliveryFee,
      targetDayOfMonth,
    });
    if (!candidate) {
      continue;
    }

    deliveryFeeCandidates.push(candidate);
    const existing = deliveryCandidatesBySaleId.get(candidate.saleId) || [];
    existing.push(candidate);
    deliveryCandidatesBySaleId.set(candidate.saleId, existing);
  }

  const tableRows = normalizedSaleIds.map((saleId) => {
    const sale = salesById.get(saleId);
    const receivableDocs = receivablesBySaleId.get(saleId) || [];
    const deliveryFeeDocs = deliveryFeesBySaleId.get(saleId) || [];

    const saleCandidate = saleCandidatesBySaleId.get(saleId) || null;
    const receivableCandidatesForSale = receivableCandidatesBySaleId.get(saleId) || [];
    const deliveryCandidatesForSale = deliveryCandidatesBySaleId.get(saleId) || [];

    const saleChanges = saleCandidate ? saleCandidate.changedCount : 0;
    const receivableChanges = countCandidateChanges(receivableCandidatesForSale);
    const deliveryFeeChanges = countCandidateChanges(deliveryCandidatesForSale);
    const totalChanges = saleChanges + receivableChanges + deliveryFeeChanges;
    const willChange = totalChanges > 0;

    const originalCreatedAt = toDateOrNull(sale?.createdAt);
    const backdatedCreatedAt = originalCreatedAt
      ? backdatePreserveUtcTime(originalCreatedAt, targetDayOfMonth)
      : null;

    return {
      saleId,
      targetDayOfMonth,
      originalSaleCreatedAt: originalCreatedAt ? formatUtc(originalCreatedAt) : "not-found",
      backdatedSaleCreatedAt: backdatedCreatedAt ? formatUtc(backdatedCreatedAt) : "not-found",
      saleFound: !!sale,
      receivableDocsFound: receivableDocs.length,
      deliveryFeeDocsFound: deliveryFeeDocs.length,
      saleChangeCount: saleChanges,
      receivableChangeCount: receivableChanges,
      deliveryFeeChangeCount: deliveryFeeChanges,
      totalTimestampChanges: totalChanges,
      saleFieldsToUpdate: saleCandidate
        ? summarizeCandidateDetails([saleCandidate])
        : "none",
      receivableFieldsToUpdate: summarizeCandidateDetails(
        receivableCandidatesForSale,
        true,
      ),
      deliveryFeeFieldsToUpdate: summarizeCandidateDetails(
        deliveryCandidatesForSale,
        true,
      ),
      applyFlagIncluded: apply,
      mode: writeEnabled ? "APPLY" : "DRY RUN",
      willChangeAnyTimestamp: willChange,
      writeExecutedThisRun: writeEnabled && willChange,
      paymentsBreakdown: sale ? formatPaymentsBreakdown(sale) : "not-found",
    };
  });

  const saleOps = buildBulkOps(saleCandidates);
  const receivableOps = buildBulkOps(receivableCandidates);
  const deliveryFeeOps = buildBulkOps(deliveryFeeCandidates);

  const saleUpdatesApplied = await executeBulkOps({
    model: Sale,
    ops: saleOps,
    writeEnabled,
  });
  const receivableUpdatesApplied = await executeBulkOps({
    model: Receivable,
    ops: receivableOps,
    writeEnabled,
  });
  const deliveryFeeUpdatesApplied = await executeBulkOps({
    model: DeliveryFee,
    ops: deliveryFeeOps,
    writeEnabled,
  });

  const updatesApplied =
    saleUpdatesApplied + receivableUpdatesApplied + deliveryFeeUpdatesApplied;

  const foundCount = tableRows.filter((row) => row.saleFound).length;
  const missingSaleIds = tableRows
    .filter((row) => !row.saleFound)
    .map((row) => row.saleId);
  const updatesPlanned = saleOps.length + receivableOps.length + deliveryFeeOps.length;
  const updatesSkipped = Math.max(0, updatesPlanned - updatesApplied);

  console.log("\nSales createdAt lookup");
  console.log(`Mode: ${writeEnabled ? "APPLY" : "DRY RUN"}`);
  console.table(
    tableRows.map((row) => ({
      id: row.saleId,
      createdAt: row.originalSaleCreatedAt,
    })),
  );

  console.log("\nSummary");
  console.log(`Requested IDs: ${saleIds.length}`);
  console.log(`Valid IDs: ${normalizedSaleIds.length}`);
  console.log(`Found sales: ${foundCount}`);
  console.log(`Missing sales: ${missingSaleIds.length}`);
  console.log(`Sale updates planned: ${saleOps.length}`);
  console.log(`Sale updates applied: ${saleUpdatesApplied}`);
  console.log(`Receivable updates planned: ${receivableOps.length}`);
  console.log(`Receivable updates applied: ${receivableUpdatesApplied}`);
  console.log(`DeliveryFee updates planned: ${deliveryFeeOps.length}`);
  console.log(`DeliveryFee updates applied: ${deliveryFeeUpdatesApplied}`);
  console.log(`Updates planned: ${updatesPlanned}`);
  console.log(`Updates applied: ${updatesApplied}`);
  console.log(`Updates skipped: ${updatesSkipped}`);

  if (invalidSaleIds.length > 0) {
    console.log("\nInvalid sale IDs");
    console.table(invalidSaleIds.map((saleId) => ({ saleId })));
  }

  if (missingSaleIds.length > 0) {
    console.log("\nMissing valid sale IDs");
    console.table(missingSaleIds.map((saleId) => ({ saleId })));
  }

  await mongoose.disconnect();
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Sale lookup failed:", error.message);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.error("Failed to disconnect cleanly:", disconnectError.message);
    }
    process.exit(1);
  });