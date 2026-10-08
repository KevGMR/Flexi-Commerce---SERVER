require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Sale = require("../models/Sale");

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { tls: true, ssl: true, family: 4 });

  const idOrLatest = process.argv[2];
  let sale;

  if (idOrLatest) {
    sale = await Sale.findById(idOrLatest).lean();
  } else {
    sale = await Sale.findOne({ salesChannel: "storefront" })
      .sort({ createdAt: -1 })
      .lean();
  }

  if (!sale) {
    console.log("No sale found.");
    await mongoose.disconnect();
    return;
  }

  console.log(JSON.stringify({
    _id: sale._id,
    salesChannel: sale.salesChannel,
    cashierId: sale.cashierId,
    receiptNumber: sale.receiptNumber,
    customerName: sale.customerName,
    customerPhone: sale.customerPhone,
    paymentStatus: sale.paymentStatus,
    status: sale.status,
    subtotal: sale.subtotal,
    taxAmount: sale.taxAmount,
    taxMode: sale.taxMode,
    taxRateUsed: sale.taxRateUsed,
    totalAmount: sale.totalAmount,
    payments: sale.payments,
    inventoryUpdates: sale.inventoryUpdates,
    inventoryStatus: sale.inventoryStatus,
    checkoutRequestId: sale.checkoutRequestId,
    notes: sale.notes,
    tags: sale.tags,
    createdAt: sale.createdAt,
    completedAt: sale.completedAt,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
