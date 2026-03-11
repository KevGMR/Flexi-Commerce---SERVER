const mongoose = require('mongoose');

const shopifySyncLogSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  syncType: {
    type: String,
    enum: ['inventory_update', 'product_fetch', 'webhook_received', 'token_refresh'],
    required: true,
    index: true
  },
  shopifyProductId: {
    type: String,
    index: true
  },
  shopifyVariantId: {
    type: String,
    index: true
  },
  flexiProductId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },
  saleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sale' // Will reference the Sale model when created
  },
  status: {
    type: String,
    // 'retrying'  = attempt failed but the queue will keep trying (transient error)
    // 'failed'    = permanent/terminal failure (product/variant deleted on Shopify or Flexi)
    // 'success'   = completed successfully
    // 'pending'   = queued, not yet attempted
    enum: ['success', 'failed', 'pending', 'retrying'],
    required: true,
    index: true
  },
  // Whether this failure is permanent (product deleted) vs transient (network/auth/etc.)
  isPermanent: {
    type: Boolean,
    default: false
  },
  requestPayload: {
    type: mongoose.Schema.Types.Mixed
  },
  responsePayload: {
    type: mongoose.Schema.Types.Mixed
  },
  errorMessage: {
    type: String
  },
  errorCode: {
    type: String
  },
  attemptNumber: {
    type: Number,
    default: 1
  },
  processingTime: {
    type: Number // Time in milliseconds
  }
}, {
  timestamps: true
});

// Compound indexes for common queries
shopifySyncLogSchema.index({ organizationId: 1, syncType: 1, status: 1 });
shopifySyncLogSchema.index({ organizationId: 1, createdAt: -1 });
shopifySyncLogSchema.index({ shopifyProductId: 1, shopifyVariantId: 1 });

const ShopifySyncLog = mongoose.model('ShopifySyncLog', shopifySyncLogSchema);

module.exports = ShopifySyncLog;
