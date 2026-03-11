const ShopifyConnection = require('../models/ShopifyConnection');
const ShopifySyncLog = require('../models/ShopifySyncLog');
const ShopifySyncQueue = require('../models/ShopifySyncQueue');
const Location = require('../models/Location');
const { getAccessToken, clearTokenCache } = require('../data/shopifyAuth');
const { processQueueItem } = require('../services/shopifySync');
const retryWorker = require('../workers/shopifyRetryWorker');
const crypto = require('crypto');
const axios = require('axios');
const express = require('express');
const router = express.Router();

// SSE clients storage (org-scoped)
const sseClients = new Map(); // organizationId -> Set of response objects

// In-memory webhook deduplication cache
const processedWebhooks = new Map(); // webhookId -> timestamp
const WEBHOOK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Clean up old webhook IDs every hour
setInterval(() => {
  const now = Date.now();
  for (const [webhookId, timestamp] of processedWebhooks.entries()) {
    if (now - timestamp > WEBHOOK_CACHE_TTL) {
      processedWebhooks.delete(webhookId);
    }
  }
}, 60 * 60 * 1000);

/**
 * Helper: Build Shopify GraphQL client for an organization
 * Automatically handles token refresh before API calls
 */
async function buildShopifyClient(connection) {
  const url = `https://${connection.storeUrl}/admin/api/${connection.apiVersion}/graphql.json`;
  
  // Check if token needs refresh (proactive: 5-minute buffer)
  const now = Date.now();
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  const needsRefresh = !connection.accessToken || expiresAt - now < 5 * 60 * 1000;

  let accessToken = connection.accessToken;

  if (needsRefresh) {
    console.log(`[Shopify] Token refresh needed for org ${connection.organizationId}`);
    
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
      console.error(`[Shopify] Token refresh failed for org ${connection.organizationId}:`, error.message);
      
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
        console.error(`[Shopify] 401 Unauthorized for org ${connection.organizationId}, attempting token refresh`);
        
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
          console.error(`[Shopify] Retry after token refresh failed:`, retryError.message);
          
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
 * Helper: Register webhooks with Shopify
 */
async function registerWebhooks(connection, callbackUrl) {
  const topics = ['products/update', 'products/delete', 'inventory_levels/update'];
  const webhooks = [];
  const graphql = await buildShopifyClient(connection);

  for (const topic of topics) {
    const mutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
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
      topic: topic.toUpperCase().replace(/\//g, '_'),
      webhookSubscription: {
        callbackUrl: `${callbackUrl}/${topic}`,
        format: 'JSON',
      },
    };

    const result = await graphql(mutation, variables);
    
    if (result.data?.webhookSubscriptionCreate?.webhookSubscription) {
      const webhook = result.data.webhookSubscriptionCreate.webhookSubscription;
      webhooks.push({
        topic,
        webhookId: webhook.id,
      });
    }
  }

  return webhooks;
}

/**
 * Helper: Delete webhooks from Shopify
 */
async function deleteWebhooks(connection) {
  const graphql = await buildShopifyClient(connection);

  for (const webhook of connection.webhooks) {
    const mutation = `
      mutation webhookSubscriptionDelete($id: ID!) {
        webhookSubscriptionDelete(id: $id) {
          deletedWebhookSubscriptionId
          userErrors {
            field
            message
          }
        }
      }
    `;

    await graphql(mutation, { id: webhook.webhookId });
  }
}

/**
 * Helper: Broadcast SSE event to organization clients
 */
function broadcastToOrg(organizationId, event) {
  const clients = sseClients.get(organizationId.toString());
  if (!clients || clients.size === 0) return;

  const eventData = `data: ${JSON.stringify(event)}\n\n`;
  
  for (const res of clients) {
    try {
      res.write(eventData);
    } catch (error) {
      // Client disconnected, will be cleaned up
      clients.delete(res);
    }
  }
}

/**
 * POST /shopify/connect
 * Connect organization to Shopify store
 */
const connect = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { storeName, storeUrl, clientId, clientSecret } = req.body;

    if (!storeName || !storeUrl || !clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: storeName, storeUrl, clientId, and clientSecret',
      });
    }

    // Check if connection already exists
    const existing = await ShopifyConnection.findOne({ organizationId });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Shopify connection already exists for this organization. Disconnect first.',
      });
    }

    // Normalize store URL
    const normalizedStoreUrl = storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // Fetch initial access token using client credentials
    let accessToken, tokenExpiresAt;
    try {
      const tokenData = await getAccessToken(normalizedStoreUrl, clientId, clientSecret, organizationId);
      accessToken = tokenData.accessToken;
      tokenExpiresAt = tokenData.expiresAt;
    } catch (error) {
      console.error('[Shopify] Initial token fetch failed:', error);
      return res.status(400).json({
        success: false,
        message: 'Failed to authenticate with Shopify. Check your clientId and clientSecret.',
        error: error.message,
      });
    }

    // Create connection record
    const connection = new ShopifyConnection({
      organizationId,
      storeName,
      storeUrl: normalizedStoreUrl,
      clientId,
      clientSecret,
      accessToken,
      tokenExpiresAt,
      lastTokenRefreshAt: new Date(),
      apiVersion: '2026-01',
      status: 'active',
    });

    // Register webhooks
    try {
      const callbackUrl = `${process.env.API_URL || 'http://localhost:9200'}/shopify/webhooks`;
      const webhooks = await registerWebhooks(connection, callbackUrl);
      connection.webhooks = webhooks;
    } catch (error) {
      console.error('Webhook registration failed:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to register webhooks with Shopify',
        error: error.message,
      });
    }

    await connection.save();

    res.status(201).json({
      success: true,
      message: 'Shopify connection created successfully',
      data: {
        storeName: connection.storeName,
        storeUrl: connection.storeUrl,
        apiVersion: connection.apiVersion,
        status: connection.status,
        webhooks: connection.webhooks.map(w => w.topic),
        tokenExpiresAt: tokenExpiresAt,
      },
    });
  } catch (error) {
    console.error('Connect error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to connect to Shopify',
      error: error.message,
    });
  }
};

/**
 * DELETE /shopify/disconnect
 * Disconnect organization from Shopify
 */
const disconnect = async (req, res) => {
  try {
    const { organizationId } = req.user;

    const connection = await ShopifyConnection.findOne({ organizationId })
      .select('+clientId +clientSecret +accessToken');

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'No Shopify connection found',
      });
    }

    // Delete webhooks from Shopify
    try {
      await deleteWebhooks(connection);
    } catch (error) {
      console.error('Webhook deletion failed:', error);
      // Continue with disconnection even if webhook deletion fails
    }

    // Clear token cache
    clearTokenCache(organizationId);

    await ShopifyConnection.deleteOne({ _id: connection._id });

    res.json({
      success: true,
      message: 'Shopify connection removed successfully',
    });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect from Shopify',
      error: error.message,
    });
  }
};

/**
 * GET /shopify/connection
 * Get Shopify connection status
 */
const getConnection = async (req, res) => {
  try {
    const { organizationId } = req.user;

    const connection = await ShopifyConnection.findOne({ organizationId })
      .select('+clientId +clientSecret');

    if (!connection) {
      return res.json({
        success: true,
        connected: false,
        data: null,
      });
    }

    res.json({
      success: true,
      connected: true,
      data: {
        storeName: connection.storeName,
        storeUrl: connection.storeUrl,
        apiVersion: connection.apiVersion,
        status: connection.status,
        lastSyncedAt: connection.lastSyncedAt,
        lastTokenRefreshAt: connection.lastTokenRefreshAt,
        webhooks: connection.webhooks.map(w => w.topic),
        syncError: connection.syncError,
        // Include credentials only for non-active connections (disconnected/error states)
        // This allows frontend form pre-fill for reconnection
        ...(connection.status !== 'active' && {
          clientId: connection.clientId,
          clientSecret: connection.clientSecret,
        }),
      },
    });
  } catch (error) {
    console.error('Get connection error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve connection status',
      error: error.message,
    });
  }
};

/**
 * GET /shopify/products
 * Fetch ALL products from Shopify (paginated automatically)
 */
const getProducts = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const selectedLocationId = req.headers['x-location-id'] || req.query.locationId;

    const connection = await ShopifyConnection.findOne({ organizationId })
      .select('+clientId +clientSecret +accessToken +tokenExpiresAt');

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'No Shopify connection found. Please connect first.',
      });
    }

    const graphql = await buildShopifyClient(connection);

    const query = `
      query getProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              descriptionHtml
              vendor
              productType
              status
              totalInventory
              variants(first: 100) {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    inventoryQuantity
                    inventoryItem {
                      id
                      inventoryLevels(first: 100) {
                        edges {
                          node {
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
              }
              images(first: 5) {
                edges {
                  node {
                    url
                    altText
                  }
                }
              }
            }
          }
        }
      }
    `;

    // Fetch all products by paginating through all pages
    const allProducts = [];
    let hasNextPage = true;
    let cursor = null;
    const scopedPageSize = selectedLocationId ? 25 : 50;
    let pageSize = scopedPageSize;
    let pageCount = 0;

    while (hasNextPage) {
      const variables = {
        first: pageSize,
        ...(cursor && { after: cursor }),
      };

      const result = await graphql(query, variables);

      if (result.errors) {
        const maxCostExceeded = result.errors.some((error) => error?.extensions?.code === 'MAX_COST_EXCEEDED');

        if (maxCostExceeded) {
          const previousPageSize = pageSize;
          pageSize = Math.max(5, Math.floor(pageSize / 2));

          if (pageSize < previousPageSize) {
            console.warn(`[Shopify] MAX_COST_EXCEEDED on page ${pageCount + 1}. Reducing page size from ${previousPageSize} to ${pageSize} and retrying.`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }
        }

        return res.status(500).json({
          success: false,
          message: 'Shopify GraphQL errors',
          errors: result.errors,
        });
      }

      const products = result.data.products.edges.map(edge => edge.node);
      allProducts.push(...products);

      hasNextPage = result.data.products.pageInfo.hasNextPage;
      cursor = result.data.products.pageInfo.endCursor;
      pageCount++;

      console.log(`[Shopify] Fetched page ${pageCount} (${products.length} products, total: ${allProducts.length})`);
    }

    const normalizeShopifyLocation = (value) => {
      if (!value) {
        return { gid: null, numeric: null };
      }
      const raw = String(value);
      const numeric = raw.replace(/[^0-9]/g, '');
      const gid = raw.startsWith('gid://')
        ? raw
        : numeric
          ? `gid://shopify/Location/${numeric}`
          : raw;
      return { gid, numeric };
    };

    const getMatchedInventoryLevel = (inventoryLevels = [], shopifyLocationId) => {
      if (!shopifyLocationId) return null;

      const target = normalizeShopifyLocation(shopifyLocationId);

      return inventoryLevels.find((levelEdge) => {
        const levelLocationId = levelEdge?.node?.location?.id;
        if (!levelLocationId) return false;

        const candidate = normalizeShopifyLocation(levelLocationId);
        if (candidate.gid && target.gid && candidate.gid === target.gid) {
          return true;
        }
        return Boolean(candidate.numeric && target.numeric && candidate.numeric === target.numeric);
      }) || null;
    };

    let scopedProducts = allProducts;
    let locationScope = {
      scoped: false,
      flexiLocationId: selectedLocationId || null,
      shopifyLocationId: null,
      shopifyLocationName: null,
      hasMapping: true,
    };

    if (selectedLocationId) {
      const flexiLocation = await Location.findOne({
        _id: selectedLocationId,
        organizationId,
      }).lean();

      if (!flexiLocation) {
        return res.status(403).json({
          success: false,
          message: 'Selected location is invalid for this organization',
        });
      }

      if (!flexiLocation.shopifyLocationId) {
        scopedProducts = [];
        locationScope = {
          scoped: true,
          flexiLocationId: selectedLocationId,
          shopifyLocationId: null,
          shopifyLocationName: null,
          hasMapping: false,
        };
      } else {
        scopedProducts = allProducts
          .map((product) => {
            const scopedVariants = (product?.variants?.edges || [])
              .map((variantEdge) => {
                const inventoryLevels = variantEdge?.node?.inventoryItem?.inventoryLevels?.edges || [];
                const matchedLevel = getMatchedInventoryLevel(
                  inventoryLevels,
                  flexiLocation.shopifyLocationId
                );

                if (!matchedLevel) {
                  return null;
                }

                const availableQuantity = matchedLevel.node.quantities?.[0]?.quantity;

                return {
                  ...variantEdge,
                  node: {
                    ...variantEdge.node,
                    inventoryQuantity:
                      typeof availableQuantity === 'number'
                        ? availableQuantity
                        : variantEdge.node.inventoryQuantity,
                  },
                };
              })
              .filter(Boolean);

            if (scopedVariants.length === 0) {
              return null;
            }

            const scopedTotalInventory = scopedVariants.reduce((sum, variantEdge) => {
              const inventoryQty = Number(variantEdge?.node?.inventoryQuantity || 0);
              return sum + inventoryQty;
            }, 0);

            return {
              ...product,
              totalInventory: scopedTotalInventory,
              variants: {
                ...product.variants,
                edges: scopedVariants,
              },
            };
          })
          .filter(Boolean);

        locationScope = {
          scoped: true,
          flexiLocationId: selectedLocationId,
          shopifyLocationId: flexiLocation.shopifyLocationId,
          shopifyLocationName: flexiLocation.shopifyLocationName || null,
          hasMapping: true,
        };
      }
    }

    // Update last synced timestamp
    connection.lastSyncedAt = new Date();
    await connection.save();

    res.json({
      success: true,
      data: {
        products: scopedProducts,
        totalCount: scopedProducts.length,
        pagesFetched: pageCount,
        locationScope,
        lastFetchedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products from Shopify',
      error: error.message,
    });
  }
};

/**
 * POST /shopify/webhooks/:topic
 * Receive Shopify webhooks
 */
const handleWebhook = async (req, res) => {
  try {
    const { topic } = req.params;
    const webhookId = req.headers['x-shopify-webhook-id'];
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const shopDomain = req.headers['x-shopify-shop-domain'];

    // Check if already processed (deduplication)
    if (processedWebhooks.has(webhookId)) {
      console.log(`Webhook ${webhookId} already processed, skipping`);
      return res.status(200).send('OK');
    }

    // Find connection by shop domain
    const connection = await ShopifyConnection.findOne({
      storeUrl: shopDomain,
    }).select('+accessToken');

    if (!connection) {
      console.warn(`No connection found for shop: ${shopDomain}`);
      return res.status(404).send('Connection not found');
    }

    // Verify webhook signature using current access token
    const secret = connection.accessToken;
    const hash = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('base64');

    if (hash !== hmac) {
      console.error('Webhook signature verification failed');
      return res.status(401).send('Unauthorized');
    }

    // Mark as processed
    processedWebhooks.set(webhookId, Date.now());

    // Broadcast to org clients via SSE
    broadcastToOrg(connection.organizationId, {
      type: 'webhook',
      topic,
      webhookId,
      payload: req.body,
      timestamp: new Date().toISOString(),
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook handling error:', error);
    res.status(500).send('Internal Server Error');
  }
};

/**
 * GET /shopify/events
 * SSE endpoint for real-time updates
 */
const sseStream = (req, res) => {
  const { organizationId } = req.user;
  const orgId = organizationId.toString();

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Add client to org's client set
  if (!sseClients.has(orgId)) {
    sseClients.set(orgId, new Set());
  }
  sseClients.get(orgId).add(res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  // Handle client disconnect
  req.on('close', () => {
    const clients = sseClients.get(orgId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(orgId);
      }
    }
  });
};

/**
 * GET /shopify/sync-queue
 * Get pending/failed sync items
 */
const getSyncQueue = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { status, needsReview } = req.query;

    const filter = { organizationId };
    if (status) filter.status = status;
    if (needsReview === 'true') filter.needsReview = true;

    const items = await ShopifySyncQueue.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({
      success: true,
      data: items,
    });
  } catch (error) {
    console.error('Get sync queue error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve sync queue',
      error: error.message,
    });
  }
};

/**
 * POST /shopify/sync-queue/process
 * Manually trigger the retry worker to process all eligible queued items immediately.
 * Useful when you don't want to wait for the next 5-minute cron tick.
 */
const processSyncQueue = async (req, res) => {
  try {
    const result = await retryWorker.runNow();

    if (!result.success) {
      return res.status(409).json({
        success: false,
        message: result.message || 'Queue processor is already running',
      });
    }

    res.json({
      success: true,
      message: `Processed ${result.processed} queued item(s)`,
      data: {
        processed: result.processed,
        duration: result.duration,
        timestamp: result.timestamp,
      },
    });
  } catch (error) {
    console.error('Process sync queue error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process sync queue',
      error: error.message,
    });
  }
};

/**
 * POST /shopify/sync-queue/:queueId/retry
 * Immediately retry a single queue item by ID.
 * Only works on items with status 'failed', 'pending', or 'needs_review'.
 */
const retrySyncQueueItem = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { queueId } = req.params;

    const item = await ShopifySyncQueue.findOne({ _id: queueId, organizationId });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Queue item not found',
      });
    }

    if (item.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Queue item is already completed',
      });
    }

    if (item.status === 'processing') {
      return res.status(409).json({
        success: false,
        message: 'Queue item is currently being processed',
      });
    }

    // Reset so it can be retried regardless of nextRetryAt or needsReview
    item.status = 'pending';
    item.needsReview = false;
    item.nextRetryAt = new Date();
    await item.save();

    const result = await processQueueItem(item);

    res.json({
      success: true,
      message: result.success ? 'Retry succeeded' : 'Retry failed — item re-queued',
      data: {
        queueId,
        success: result.success,
        ...(result.error ? { error: result.error, permanent: result.permanent } : {}),
      },
    });
  } catch (error) {
    console.error('Retry sync queue item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retry queue item',
      error: error.message,
    });
  }
};

/**
 * GET /shopify/sync-logs
 * Get sync history
 */
const getSyncLogs = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { syncType, status, limit = 50 } = req.query;

    const filter = { organizationId };
    if (syncType) filter.syncType = syncType;
    if (status) filter.status = status;

    const logs = await ShopifySyncLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error('Get sync logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve sync logs',
      error: error.message,
    });
  }
};

// Route bindings
router.post('/connect', connect);
router.delete('/disconnect', disconnect);
router.get('/connection', getConnection);
router.get('/products', getProducts);
router.get('/sync-queue', getSyncQueue);
router.post('/sync-queue/process', processSyncQueue);         // manual trigger
router.post('/sync-queue/:queueId/retry', retrySyncQueueItem); // single-item retry
router.get('/sync-logs', getSyncLogs);

// Webhooks: need raw body for HMAC verification
router.post('/webhooks/:topic', express.raw({ type: 'application/json' }), handleWebhook);

// SSE for org-scoped events
router.get('/events', sseStream);

module.exports = router;
