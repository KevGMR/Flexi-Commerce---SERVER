const ShopifyConnection = require('../models/ShopifyConnection');
const ShopifySyncLog = require('../models/ShopifySyncLog');
const ShopifySyncQueue = require('../models/ShopifySyncQueue');
const Sale = require('../models/Sale');
const { getAccessToken } = require('../data/shopifyAuth');
const axios = require('axios');

/**
 * Build Shopify GraphQL client with automatic token refresh
 */
async function buildShopifyClient(connection) {
  const url = `https://${connection.storeUrl}/admin/api/${connection.apiVersion}/graphql.json`;
  
  // Check if token needs refresh (proactive: 5-minute buffer)
  const now = Date.now();
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  const needsRefresh = !connection.accessToken || expiresAt - now < 5 * 60 * 1000;

  let accessToken = connection.accessToken;

  if (needsRefresh) {
    console.log(`[Shopify Sync] Token refresh needed for org ${connection.organizationId}`);
    
    try {
      const { accessToken: newToken, expiresAt: newExpiresAt } = await getAccessToken(
        connection.storeUrl,
        connection.clientId,
        connection.clientSecret,
        connection.organizationId
      );

      // Update connection with new token
      await ShopifyConnection.updateOne(
        { _id: connection._id },
        {
          $set: {
            accessToken: newToken,
            tokenExpiresAt: newExpiresAt,
            lastTokenRefreshAt: new Date(),
            status: 'active',
            syncError: null,
          },
        }
      );

      accessToken = newToken;
      connection.accessToken = newToken;
      connection.tokenExpiresAt = newExpiresAt;
    } catch (error) {
      console.error(`[Shopify Sync] Token refresh failed for org ${connection.organizationId}:`, error.message);
      
      // Update connection status to error
      await ShopifyConnection.updateOne(
        { _id: connection._id },
        {
          $set: {
            status: 'error',
            syncError: {
              message: `Token refresh failed: ${error.message}`,
              occurredAt: new Date(),
            },
          },
        }
      );

      throw new Error(`Failed to refresh Shopify access token: ${error.message}`);
    }
  }
  
  return async (query, variables = {}) => {
    try {
      const { data } = await axios.post(
        url,
        { query, variables },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        }
      );

      // Handle rate limiting
      const cost = data.extensions?.cost;
      if (cost) {
        const queryCost = cost.actualQueryCost;
        const available = cost.throttleStatus?.currentlyAvailable || 1000;
        const restoreRate = cost.throttleStatus?.restoreRate || 50;
        
        if (available - queryCost < 0) {
          const restoreTime = Math.ceil(queryCost / restoreRate) * 2000;
          await new Promise(resolve => setTimeout(resolve, restoreTime));
        }
      }

      return data;
    } catch (error) {
      // Handle 401 Unauthorized - attempt token refresh and retry once
      if (error.response?.status === 401) {
        console.error(`[Shopify Sync] 401 Unauthorized for org ${connection.organizationId}, attempting token refresh`);
        
        try {
          const { accessToken: newToken, expiresAt: newExpiresAt } = await getAccessToken(
            connection.storeUrl,
            connection.clientId,
            connection.clientSecret,
            connection.organizationId
          );

          // Update connection
          await ShopifyConnection.updateOne(
            { _id: connection._id },
            {
              $set: {
                accessToken: newToken,
                tokenExpiresAt: newExpiresAt,
                lastTokenRefreshAt: new Date(),
                status: 'active',
                syncError: null,
              },
            }
          );

          accessToken = newToken;

          // Retry the request with new token
          const { data } = await axios.post(
            url,
            { query, variables },
            {
              headers: {
                'X-Shopify-Access-Token': newToken,
                'Content-Type': 'application/json',
              },
            }
          );

          return data;
        } catch (retryError) {
          console.error(`[Shopify Sync] Retry after token refresh failed:`, retryError.message);
          
          await ShopifyConnection.updateOne(
            { _id: connection._id },
            {
              $set: {
                status: 'error',
                syncError: {
                  message: `Auth failed after token refresh: ${retryError.message}`,
                  occurredAt: new Date(),
                },
              },
            }
          );

          throw retryError;
        }
      }

      console.error('Shopify GraphQL Error:', error?.response?.data || error.message);
      throw error;
    }
  };
}

/**
 * Helper: extract available quantity from InventoryLevel.quantities
 */
function getAvailableQuantity(levelNode) {
  const quantities = Array.isArray(levelNode?.quantities) ? levelNode.quantities : [];
  const entry = quantities.find(q => (q.name || '').toLowerCase() === 'available');
  return entry ? entry.quantity : 0;
}

/**
 * Helper: find inventory level matching a given Shopify location id (gid or numeric).
 */
function getMatchedInventoryLevel(inventoryLevels, shopifyLocationId) {
  if (!Array.isArray(inventoryLevels) || inventoryLevels.length === 0) return null;
  if (!shopifyLocationId) return inventoryLevels[0]?.node || null;

  const normalizedGid = shopifyLocationId.startsWith('gid://')
    ? shopifyLocationId
    : `gid://shopify/Location/${shopifyLocationId}`;

  // Exact gid match
  const exact = inventoryLevels.find(({ node }) => node.location?.id === normalizedGid)?.node;
  if (exact) return exact;

  // Fallback: match by numeric suffix (if user stored numeric id)
  const numeric = shopifyLocationId.replace(/[^0-9]/g, '');
  if (numeric) {
    const suffix = inventoryLevels.find(({ node }) => (node.location?.id || '').endsWith(numeric))?.node;
    if (suffix) return suffix;
  }

  return null;
}

/**
 * Update inventory in Shopify
 * @param {String} organizationId - Organization ID
 * @param {String} shopifyVariantId - Shopify variant ID
 * @param {Number} quantityChange - Change in quantity (negative for sales)
 * @param {String} saleId - Sale ID (optional)
 * @param {String} shopifyLocationId - Override Shopify location ID (optional, uses first if not provided)
 */
async function updateShopifyInventory(organizationId, shopifyVariantId, quantityChange, saleId = null, shopifyLocationId = null) {
  const startTime = Date.now();
  
  try {
    // Get connection
    const connection = await ShopifyConnection.findOne({ organizationId })
      .select('+clientId +clientSecret +accessToken +tokenExpiresAt');

    if (!connection) {
      throw new Error('No Shopify connection found for organization');
    }

    const graphql = await buildShopifyClient(connection);

    // First, get the inventory item ID and current quantity
    const getInventoryQuery = `
      query getInventory($id: ID!) {
        productVariant(id: $id) {
          inventoryItem {
            id
            inventoryLevels(first: 50) {
              edges {
                node {
                  id
                  location {
                    id
                    name
                  }
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    `;

    const inventoryResult = await graphql(getInventoryQuery, { id: shopifyVariantId });

    if (inventoryResult.errors) {
      throw new Error(`Shopify errors: ${JSON.stringify(inventoryResult.errors)}`);
    }

    const inventoryItem = inventoryResult.data.productVariant?.inventoryItem;
    const inventoryLevels = inventoryItem?.inventoryLevels?.edges || [];

    if (inventoryLevels.length === 0) {
      console.warn(`[Shopify Sync] No inventory locations tracked for variant ${shopifyVariantId}`);
      throw new Error('No inventory location found for variant. Ensure inventory tracking is enabled in Shopify.');
    }

    // Find the specified or first inventory level
    const inventoryLevel = getMatchedInventoryLevel(inventoryLevels, shopifyLocationId);

    if (!inventoryLevel) {
      const availableLocations = inventoryLevels.map(({ node }) => node.location?.id).filter(Boolean);
      throw new Error(`Shopify location ${shopifyLocationId || '[not provided]'} not found for this variant. Available: ${availableLocations.join(', ')}`);
    }

    const currentQuantity = getAvailableQuantity(inventoryLevel);
    const newQuantity = currentQuantity + quantityChange; // quantityChange is typically negative for sales

    // Update inventory using inventoryAdjustQuantities mutation
    const updateMutation = `
      mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          inventoryAdjustmentGroup {
            id
            reason
            changes {
              name
              delta
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        reason: 'correction',
        name: 'available',
        changes: [
          {
            inventoryItemId: inventoryItem.id,
            locationId: inventoryLevel.location.id,
            delta: quantityChange,
          },
        ],
      },
    };

    const updateResult = await graphql(updateMutation, variables);

    if (updateResult.errors || updateResult.data.inventoryAdjustQuantities?.userErrors?.length > 0) {
      const errors = updateResult.errors || updateResult.data.inventoryAdjustQuantities.userErrors;
      throw new Error(`Shopify inventory update failed: ${JSON.stringify(errors)}`);
    }

    // Log successful sync
    await ShopifySyncLog.create({
      organizationId,
      syncType: 'inventory_update',
      shopifyVariantId,
      saleId,
      status: 'success',
      requestPayload: {
        quantityChange,
        newQuantity,
        locationId: inventoryLevel.location.id,
      },
      responsePayload: updateResult.data,
      processingTime: Date.now() - startTime,
    });

    return {
      success: true,
      newQuantity,
      locationId: inventoryLevel.location.id,
    };

  } catch (error) {
    console.error('Shopify inventory update error:', error);

    // Log failed sync
    await ShopifySyncLog.create({
      organizationId,
      syncType: 'inventory_update',
      shopifyVariantId,
      saleId,
      status: 'failed',
      errorMessage: error.message,
      errorCode: error.code || 'UNKNOWN',
      processingTime: Date.now() - startTime,
    });

    throw error;
  }
}

/**
 * Queue inventory update for retry
 */
async function queueInventoryUpdate(organizationId, shopifyProductId = null, shopifyVariantId, quantityChange, newQuantity = null, saleId = null, locationId = null) {
  try {
    const queueItem = await ShopifySyncQueue.create({
      organizationId,
      shopifyProductId,
      shopifyVariantId,
      saleId,
      inventoryUpdate: {
        quantityChange,
        newQuantity,
        locationId,
      },
      status: 'pending',
      attemptCount: 0,
      nextRetryAt: new Date(), // Retry immediately first time
    });

    return queueItem;
  } catch (error) {
    console.error('Queue creation error:', error);
    throw error;
  }
}

/**
 * Process a single queue item
 */
async function processQueueItem(queueItem) {
  console.log("Processing queue item:", queueItem._id);

  const startTime = Date.now();

  try {
    // Mark as processing
    queueItem.status = 'processing';
    await queueItem.save();

    // Get connection
    const connection = await ShopifyConnection.findOne({ organizationId: queueItem.organizationId })
      .select('+clientId +clientSecret +accessToken +tokenExpiresAt');

    if (!connection) {
      throw new Error('No Shopify connection found');
    }

    const graphql = await buildShopifyClient(connection);

    // Get inventory item details
    const getInventoryQuery = `
      query getInventory($id: ID!) {
        productVariant(id: $id) {
          inventoryItem {
            id
            inventoryLevels(first: 50) {
              edges {
                node {
                  id
                  location {
                    id
                    name
                  }
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }
      }
    `;

    const inventoryResult = await graphql(getInventoryQuery, { id: queueItem.shopifyVariantId });

    if (inventoryResult.errors) {
      throw new Error(`Shopify errors: ${JSON.stringify(inventoryResult.errors)}`);
    }

    const inventoryItem = inventoryResult.data.productVariant?.inventoryItem;
    const inventoryLevels = inventoryItem?.inventoryLevels?.edges || [];

    if (inventoryLevels.length === 0) {
      console.warn(`[Shopify Sync] No inventory locations tracked for variant ${queueItem.shopifyVariantId}`);
      throw new Error('No inventory location found for variant. Ensure inventory tracking is enabled in Shopify.');
    }

    const inventoryLevel = getMatchedInventoryLevel(inventoryLevels, queueItem.inventoryUpdate?.locationId);

    if (!inventoryLevel) {
      const availableLocations = inventoryLevels.map(({ node }) => node.location?.id).filter(Boolean);
      throw new Error(`No inventory location found for variant (requested: ${queueItem.inventoryUpdate?.locationId || '[not provided]'}, available: ${availableLocations.join(', ')})`);
    }

    // Update inventory
    const updateMutation = `
      mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          inventoryAdjustmentGroup {
            id
            reason
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        reason: 'correction',
        name: 'available',
        changes: [
          {
            inventoryItemId: inventoryItem.id,
            locationId: inventoryLevel.location.id,
            delta: queueItem.inventoryUpdate.quantityChange,
          },
        ],
      },
    };

    const updateResult = await graphql(updateMutation, variables);

    if (updateResult.errors || updateResult.data.inventoryAdjustQuantities?.userErrors?.length > 0) {
      const errors = updateResult.errors || updateResult.data.inventoryAdjustQuantities.userErrors;
      throw new Error(`Shopify inventory update failed: ${JSON.stringify(errors)}`);
    }

    // Mark as completed
    queueItem.status = 'completed';
    queueItem.completedAt = new Date();
    await queueItem.save();

    // Log success
    await ShopifySyncLog.create({
      organizationId: queueItem.organizationId,
      syncType: 'inventory_update',
      shopifyVariantId: queueItem.shopifyVariantId,
      saleId: queueItem.saleId,
      status: 'success',
      requestPayload: queueItem.inventoryUpdate,
      responsePayload: updateResult.data,
      attemptNumber: queueItem.attemptCount + 1,
      processingTime: Date.now() - startTime,
    });

    if (queueItem.saleId) {
      const pending = await ShopifySyncQueue.countDocuments({
        saleId: queueItem.saleId,
        status: { $in: ['pending', 'processing', 'failed', 'needs_review'] },
      });

      const saleStatus = pending > 0 ? 'partial' : 'synced';

      await Sale.updateOne(
        { _id: queueItem.saleId },
        {
          $set: { shopifySyncStatus: saleStatus },
          $push: {
            shopifySyncLog: {
              shopifyVariantId: queueItem.shopifyVariantId,
              status: 'success',
              timestamp: new Date(),
            },
          },
        }
      );
    }

    return { success: true };

  } catch (error) {
    console.error('Process queue item error:', error);

    // Increment attempt count
    queueItem.attemptCount += 1;
    queueItem.lastError = {
      message: error.message,
      code: error.code || 'UNKNOWN',
      occurredAt: new Date(),
    };

    // Check if max attempts reached
    if (queueItem.attemptCount >= queueItem.maxAttempts) {
      queueItem.status = 'needs_review';
      queueItem.needsReview = true;
    } else {
      // Calculate next retry time with exponential backoff
      const backoffMinutes = Math.pow(2, queueItem.attemptCount); // 1, 2, 4, 8, 16, 32, 64, 128, 256, 512 minutes
      queueItem.nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
      queueItem.status = 'failed';
    }

    await queueItem.save();

    // Log failure
    await ShopifySyncLog.create({
      organizationId: queueItem.organizationId,
      syncType: 'inventory_update',
      shopifyVariantId: queueItem.shopifyVariantId,
      saleId: queueItem.saleId,
      status: 'failed',
      errorMessage: error.message,
      errorCode: error.code || 'UNKNOWN',
      attemptNumber: queueItem.attemptCount,
      processingTime: Date.now() - startTime,
    });

    if (queueItem.saleId) {
      const saleStatus = queueItem.status === 'needs_review' ? 'failed' : 'pending';

      await Sale.updateOne(
        { _id: queueItem.saleId },
        {
          $set: { shopifySyncStatus: saleStatus },
          $push: {
            shopifySyncLog: {
              shopifyVariantId: queueItem.shopifyVariantId,
              status: 'failed',
              error: error.message,
              timestamp: new Date(),
            },
          },
        }
      );
    }

    return { success: false, error: error.message };
  }
}

/**
 * Process retry queue
 */
async function processRetryQueue() {
  try {
    const now = new Date();

    // Find items ready for retry
    const items = await ShopifySyncQueue.find({
      status: { $in: ['pending', 'failed'] },
      nextRetryAt: { $lte: now },
      attemptCount: { $lt: 10 },
    }).limit(10); // Process 10 at a time

    console.log(`Processing ${items.length} queued items`);

    for (const item of items) {
      await processQueueItem(item);
    }

    return {
      processed: items.length,
      timestamp: new Date(),
    };

  } catch (error) {
    console.error('Process retry queue error:', error);
    throw error;
  }
}

/**
 * Sync inventory on sale
 */
async function syncInventoryOnSale(organizationId, shopifyProductId, shopifyVariantId, quantityChange, saleId, shopifyLocationId = null) {
  try {
    // Try immediate sync
    const result = await updateShopifyInventory(organizationId, shopifyVariantId, quantityChange, saleId, shopifyLocationId);
    return {
      success: true,
      synced: true,
      warning: null,
      ...result,
    };
  } catch (error) {
    console.error('Immediate sync failed, queuing for retry:', error);

    // Queue for retry
    await queueInventoryUpdate(
      organizationId,
      shopifyProductId,
      shopifyVariantId,
      quantityChange,
      null, // newQuantity will be calculated during retry
      saleId,
      shopifyLocationId // Pass location for retry consistency
    );

    return {
      success: true,
      synced: false,
      warning: 'Inventory sync failed, queued for retry',
      error: error.message,
    };
  }
}

module.exports = {
  updateShopifyInventory,
  queueInventoryUpdate,
  processQueueItem,
  processRetryQueue,
  syncInventoryOnSale,
};
