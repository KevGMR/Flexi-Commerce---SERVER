// server/services/inventoryUpdater.js
//
// Shared inventory update logic for sales. Extracted from Sales.js so the
// M-Pesa callback (POS STK flow) can call it after the customer enters
// their PIN. Storefront checkout also uses this.

const Inventory = require("../models/Inventory");
const Variant = require("../models/Variant");
const Location = require("../models/Location");
const ShopifyConnection = require("../models/ShopifyConnection");
const {
  updateShopifyInventory,
  queueInventoryUpdate,
} = require("./shopifySync");

/**
 * Apply inventory deductions for a sale that has already been persisted.
 * Mutates sale.inventoryUpdates, sale.shopifySyncStatus, sale.shopifySyncLog
 * and returns the saved sale. Pass a mongoose session if running inside a
 * transaction; omit for standalone calls (POS callback).
 */
async function processInventoryUpdates(sale, organizationId, session) {
  const query = ShopifyConnection.findOne({ organizationId })
    .select("+clientId +clientSecret +accessToken +tokenExpiresAt");
  if (session) query.session(session);
  const connection = await query;

  const flexiLocationQuery = Location.findOne({
    _id: sale.locationId,
    organizationId,
  });
  if (session) flexiLocationQuery.session(session);
  const flexiLocation = await flexiLocationQuery;

  let totalShopifyItems = 0;
  let syncedCount = 0;
  let queuedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < sale.items.length; i++) {
    const item = sale.items[i];

    // ---------- FLEXI (variant-level) ----------
    if (item.type === "flexi") {
      if (!item.variantId) {
        throw new Error(
          `Flexi item at index ${i} is missing variantId — cannot update inventory`,
        );
      }

      const inventoryQuery = Inventory.findOne({
        organizationId,
        variantId: item.variantId,
        locationId: sale.locationId,
      });
      if (session) inventoryQuery.session(session);
      const inventory = await inventoryQuery;

      if (!inventory) {
        sale.inventoryUpdates.push({
          itemId: i.toString(),
          type: "flexi",
          variantId: item.variantId,
          productId: item.productId,
          quantityDeducted: item.quantity,
          status: "failed",
          error: `No inventory row for variant ${item.variantId} at location ${sale.locationId}`,
        });
        continue;
      }

      const variantQuery = Variant.findById(item.variantId)
        .select("trackInventory continueSellingWhenOutOfStock");
      if (session) variantQuery.session(session);
      const variant = await variantQuery.lean();

      const isTracked = variant?.trackInventory !== false;
      const canOversell = variant?.continueSellingWhenOutOfStock === true;

      const previousOnHand = inventory.onHand || 0;
      const previousAvailable = inventory.available ?? inventory.onHand ?? 0;

      if (isTracked && !canOversell && previousAvailable < item.quantity) {
        throw new Error(
          `Insufficient stock for variant ${item.variantId} at location ${sale.locationId}. Available: ${previousAvailable}, requested: ${item.quantity}`,
        );
      }

      const newOnHand = previousOnHand - item.quantity;
      const newAvailable = previousAvailable - item.quantity;

      await Inventory.updateOne(
        { _id: inventory._id },
        {
          $set: {
            onHand: newOnHand,
            available: newAvailable,
            lastModified: new Date(),
          },
        },
        session ? { session } : {},
      );

      sale.inventoryUpdates.push({
        itemId: i.toString(),
        type: "flexi",
        variantId: item.variantId,
        productId: item.productId,
        quantityDeducted: item.quantity,
        previousStock: previousOnHand,
        newStock: newOnHand,
        status: "success",
      });
    }

    // ---------- SHOPIFY ----------
    else if (item.type === "shopify" && connection) {
      totalShopifyItems += 1;
      try {
        await updateShopifyInventory(
          organizationId,
          item.shopifyVariantId,
          -item.quantity,
          sale._id,
          flexiLocation?.shopifyLocationId,
        );

        sale.inventoryUpdates.push({
          itemId: i.toString(),
          type: "shopify",
          shopifyVariantId: item.shopifyVariantId,
          quantityDeducted: item.quantity,
          status: "success",
        });
        syncedCount += 1;
      } catch (error) {
        console.error(
          `[Sales] Shopify inventory update failed for item ${i}:`,
          error.message,
        );

        if (error.permanent === true) {
          sale.inventoryUpdates.push({
            itemId: i.toString(),
            type: "shopify",
            shopifyVariantId: item.shopifyVariantId,
            quantityDeducted: item.quantity,
            status: "failed",
            error: error.message,
          });
          failedCount += 1;
          sale.shopifySyncLog.push({
            shopifyVariantId: item.shopifyVariantId,
            itemIndex: i,
            status: "failed",
            error: error.message,
          });
          continue;
        }

        try {
          await queueInventoryUpdate(
            organizationId,
            null,
            item.shopifyVariantId,
            -item.quantity,
            null,
            sale._id,
            flexiLocation?.shopifyLocationId,
          );

          sale.inventoryUpdates.push({
            itemId: i.toString(),
            type: "shopify",
            shopifyVariantId: item.shopifyVariantId,
            quantityDeducted: item.quantity,
            status: "pending",
            error: error.message,
          });
          queuedCount += 1;
          sale.shopifySyncLog.push({
            shopifyVariantId: item.shopifyVariantId,
            itemIndex: i,
            status: "retrying",
            error: error.message,
          });
        } catch (queueError) {
          console.error(
            `[Sales] Queueing Shopify inventory update failed for item ${i}:`,
            queueError.message,
          );
          sale.inventoryUpdates.push({
            itemId: i.toString(),
            type: "shopify",
            shopifyVariantId: item.shopifyVariantId,
            quantityDeducted: item.quantity,
            status: "failed",
            error: queueError.message,
          });
          failedCount += 1;
          sale.shopifySyncLog.push({
            shopifyVariantId: item.shopifyVariantId,
            itemIndex: i,
            status: "failed",
            error: queueError.message,
          });
        }
      }
    }
  }

  if (totalShopifyItems > 0) {
    if (syncedCount === totalShopifyItems) {
      sale.shopifySyncStatus = "synced";
    } else if (syncedCount > 0 || (queuedCount > 0 && failedCount > 0)) {
      sale.shopifySyncStatus = "partial";
    } else if (queuedCount > 0) {
      sale.shopifySyncStatus = "pending";
    } else if (failedCount > 0) {
      sale.shopifySyncStatus = "failed";
    }
  }

  await sale.save(session ? { session } : {});
  return sale;
}

module.exports = { processInventoryUpdates };