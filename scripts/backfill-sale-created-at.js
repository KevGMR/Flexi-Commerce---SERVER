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

const parseObjectId = (value, name) => {
  if (!value) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`${name} must be a valid ObjectId`);
  }

  return new mongoose.Types.ObjectId(value);
};

const DDMMYYYY_HHMM_REGEX = /^(\d{2})\/(\d{2})\/(\d{4})\/(\d{2}):(\d{2})$/;

const daysInUtcMonth = (year, monthOneBased) => {
  return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();
};

const parseDdMmYyyyHhMmToUtcDate = (value) => {
  const match = DDMMYYYY_HHMM_REGEX.exec(value || "");
  if (!match) {
    return null;
  }

  const inputDay = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);

  if (
    inputDay < 1 ||
    inputDay > 31 ||
    month < 1 ||
    month > 12 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const maxDay = daysInUtcMonth(year, month);
  const day = Math.min(inputDay, maxDay);

  return {
    date: new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0)),
    normalized: day !== inputDay,
    normalizedFrom: `${String(inputDay).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}/${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    normalizedTo: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}/${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
};

const parseFlexibleDateArgToUtc = (value, name) => {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  const customParsed = parseDdMmYyyyHhMmToUtcDate(value);
  if (customParsed) {
    return customParsed;
  }

  // Keep ISO compatibility to avoid breaking existing script callers.
  const isoParsed = new Date(value);
  if (!Number.isNaN(isoParsed.getTime())) {
    return {
      date: isoParsed,
      normalized: false,
      normalizedFrom: value,
      normalizedTo: value,
    };
  }

  throw new Error(
    `${name} is invalid: ${value}. Accepted formats: dd/mm/yyyy/hh:mm or ISO datetime`,
  );
};

const parseDateTimeArg = (value, name) => {
  return parseFlexibleDateArgToUtc(value, name);
};

const parseTargetDate = (value) => {
  const parsed = parseFlexibleDateArgToUtc(value, "--targetDate");

  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth(),
    day: parsed.getUTCDate(),
  };
};

const parsePositiveInteger = (value, fallback) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--sampleSize must be a positive integer (received: ${value})`);
  }

  return parsed;
};

const pad2 = (value) => String(value).padStart(2, "0");
const pad3 = (value) => String(value).padStart(3, "0");

const formatUtc = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "invalid-date";
  }

  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}T${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}:${pad2(value.getUTCSeconds())}.${pad3(value.getUTCMilliseconds())}+00:00`;
};

const toShiftedDatePreserveUtcTime = (originalDate, targetDateParts) => {
  return new Date(
    Date.UTC(
      targetDateParts.year,
      targetDateParts.month,
      targetDateParts.day,
      originalDate.getUTCHours(),
      originalDate.getUTCMinutes(),
      originalDate.getUTCSeconds(),
      originalDate.getUTCMilliseconds(),
    ),
  );
};

const assertTimePreserved = (before, after) => {
  return (
    before.getUTCHours() === after.getUTCHours() &&
    before.getUTCMinutes() === after.getUTCMinutes() &&
    before.getUTCSeconds() === after.getUTCSeconds() &&
    before.getUTCMilliseconds() === after.getUTCMilliseconds()
  );
};

const logUsage = () => {
  console.log("\nUsage:");
  console.log(
    "node scripts/backfill-sale-created-at.js --organizationId <ObjectId> --startDateTime <dd/mm/yyyy/hh:mm|ISO> --endDateTime <dd/mm/yyyy/hh:mm|ISO> --targetDate <dd/mm/yyyy/hh:mm|ISO> [--locationId <ObjectId>] [--sampleSize <number>] [--apply] [--dry-run]",
  );
  console.log("\nNotes:");
  console.log("- Dry-run is the default mode.");
  console.log("- Accepted date input format: dd/mm/yyyy/hh:mm (converted to UTC).");
  console.log("- Date interpretation and transform are performed in UTC.");
  console.log("- Time-of-day is preserved from each original createdAt timestamp.");
};

async function main() {
  const apply = hasFlag("--apply");
  const dryRun = !apply || hasFlag("--dry-run");

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set");
  }

  const organizationIdRaw = getArgValue("--organizationId");
  const locationIdRaw = getArgValue("--locationId");
  const startDateTimeRaw = getArgValue("--startDateTime");
  const endDateTimeRaw = getArgValue("--endDateTime");
  const targetDateRaw = getArgValue("--targetDate");
  const sampleSizeRaw = getArgValue("--sampleSize");

  if (!organizationIdRaw || !startDateTimeRaw || !endDateTimeRaw || !targetDateRaw) {
    logUsage();
    throw new Error(
      "Missing required args: --organizationId --startDateTime --endDateTime --targetDate",
    );
  }

  const organizationId = parseObjectId(organizationIdRaw, "--organizationId");
  const locationId = parseObjectId(locationIdRaw, "--locationId");
  const startDateParsed = parseFlexibleDateArgToUtc(startDateTimeRaw, "--startDateTime");
  const endDateParsed = parseFlexibleDateArgToUtc(endDateTimeRaw, "--endDateTime");
  const targetDateParsed = parseFlexibleDateArgToUtc(targetDateRaw, "--targetDate");

  const startDateTime = startDateParsed.date;
  const endDateTime = endDateParsed.date;
  const targetDateParts = {
    year: targetDateParsed.date.getUTCFullYear(),
    month: targetDateParsed.date.getUTCMonth(),
    day: targetDateParsed.date.getUTCDate(),
  };
  const sampleSize = parsePositiveInteger(sampleSizeRaw, 20);

  if (startDateTime.getTime() > endDateTime.getTime()) {
    throw new Error("--startDateTime must be less than or equal to --endDateTime");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const query = {
    organizationId,
    createdAt: {
      $gte: startDateTime,
      $lte: endDateTime,
    },
  };

  if (locationId) {
    query.locationId = locationId;
  }

  const stats = {
    salesScanned: 0,
    salesMatched: 0,
    salesWouldUpdate: 0,
    salesUpdated: 0,
    salesUnchanged: 0,
    timePreservationFailures: 0,
    errors: 0,
  };

  const sampleRows = [];
  let bulkOps = [];
  const bulkChunkSize = 500;

  const cursor = Sale.find(query)
    .select("_id createdAt")
    .sort({ createdAt: 1 })
    .lean()
    .cursor();

  for await (const sale of cursor) {
    stats.salesScanned += 1;

    const originalCreatedAt = new Date(sale.createdAt);
    if (Number.isNaN(originalCreatedAt.getTime())) {
      stats.errors += 1;
      continue;
    }

    stats.salesMatched += 1;

    const shiftedCreatedAt = toShiftedDatePreserveUtcTime(
      originalCreatedAt,
      targetDateParts,
    );

    if (!assertTimePreserved(originalCreatedAt, shiftedCreatedAt)) {
      stats.timePreservationFailures += 1;
      stats.errors += 1;
      continue;
    }

    if (originalCreatedAt.getTime() === shiftedCreatedAt.getTime()) {
      stats.salesUnchanged += 1;
      continue;
    }

    stats.salesWouldUpdate += 1;

    if (sampleRows.length < sampleSize) {
      sampleRows.push({
        saleId: String(sale._id),
        beforeCreatedAtUtc: formatUtc(originalCreatedAt),
        afterCreatedAtUtc: formatUtc(shiftedCreatedAt),
        beforeCreatedAtString: originalCreatedAt.toString(),
        afterCreatedAtString: shiftedCreatedAt.toString(),
      });
    }

    if (!dryRun) {
      bulkOps.push({
        updateOne: {
          filter: { _id: sale._id },
          update: { $set: { createdAt: shiftedCreatedAt } },
        },
      });

      if (bulkOps.length >= bulkChunkSize) {
        const writeResult = await Sale.collection.bulkWrite(bulkOps, {
          ordered: false,
        });
        stats.salesUpdated += writeResult.modifiedCount || 0;
        bulkOps = [];
      }
    }
  }

  if (!dryRun && bulkOps.length > 0) {
    const writeResult = await Sale.collection.bulkWrite(bulkOps, {
      ordered: false,
    });
    stats.salesUpdated += writeResult.modifiedCount || 0;
  }

  console.log("\nBackfill sale createdAt summary");
  console.table(stats);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);
  console.log("\n--- Input to UTC Conversion ---");
  console.log(`Input Start: ${startDateTimeRaw} -> ${formatUtc(startDateTime)}`);
  if (startDateParsed.normalized) {
    console.log(`  (auto-normalized: ${startDateParsed.normalizedFrom} -> ${startDateParsed.normalizedTo})`);
  }
  console.log(`Input End: ${endDateTimeRaw} -> ${formatUtc(endDateTime)}`);
  if (endDateParsed.normalized) {
    console.log(`  (auto-normalized: ${endDateParsed.normalizedFrom} -> ${endDateParsed.normalizedTo})`);
  }
  console.log(`Input Target: ${targetDateRaw} -> ${formatUtc(targetDateParsed.date)}`);
  if (targetDateParsed.normalized) {
    console.log(`  (auto-normalized: ${targetDateParsed.normalizedFrom} -> ${targetDateParsed.normalizedTo})`);
  }
  console.log("\n--- Query Setup ---");
  console.log(`UTC Source Range: ${formatUtc(startDateTime)} -> ${formatUtc(endDateTime)}`);
  console.log(`To String Range: ${startDateTime.toString()} -> ${endDateTime.toString()}`);
  console.log(
    `Target Date (date portion): ${String(targetDateParts.day).padStart(2, "0")}/${String(targetDateParts.month + 1).padStart(2, "0")}/${targetDateParts.year}`,
  );
  console.log(`Target UTC (full timestamp): ${formatUtc(targetDateParsed.date)}`);
  console.log(`Note: Each matched sale shifts to target date while preserving its original time-of-day.`);
  console.log(`Organization Scope: ${organizationIdRaw}`);
  console.log(`Location Scope: ${locationIdRaw || "ALL"}`);

  if (sampleRows.length > 0) {
    console.log(`\nPreview (first ${sampleRows.length} row(s))`);
    console.table(sampleRows);
  } else {
    console.log("\nNo matching rows required a createdAt update.");
  }

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