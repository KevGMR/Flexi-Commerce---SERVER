const mongoose = require('mongoose');

const shopifySyncQueueSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  shopifyProductId: {
    type: String,
    required: false,
    index: true
  },
  shopifyVariantId: {
    type: String,
    required: true,
    index: true
  },
  saleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sale'
  },
  inventoryUpdate: {
    quantityChange: {
      type: Number,
      required: true
    },
    newQuantity: {
      type: Number,
      required: false,
      default: null
    },
    locationId: {
      type: String // Shopify location ID
    }
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'failed', 'completed', 'needs_review'],
    default: 'pending',
    index: true
  },
  attemptCount: {
    type: Number,
    default: 0,
    max: 10
  },
  maxAttempts: {
    type: Number,
    default: 10
  },
  nextRetryAt: {
    type: Date,
    index: true
  },
  lastError: {
    message: String,
    code: String,
    occurredAt: Date
  },
  needsReview: {
    type: Boolean,
    default: false,
    index: true
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Compound indexes for queue processing
shopifySyncQueueSchema.index({ status: 1, nextRetryAt: 1 });
shopifySyncQueueSchema.index({ organizationId: 1, status: 1 });
shopifySyncQueueSchema.index({ organizationId: 1, needsReview: 1 });
shopifySyncQueueSchema.index({ shopifyProductId: 1, shopifyVariantId: 1, status: 1 });

const ShopifySyncQueue = mongoose.model('ShopifySyncQueue', shopifySyncQueueSchema);

module.exports = ShopifySyncQueue;
