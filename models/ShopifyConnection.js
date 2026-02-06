const mongoose = require('mongoose');

const shopifyConnectionSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  storeName: {
    type: String,
    required: true,
    trim: true
  },
  storeUrl: {
    type: String,
    required: true,
    trim: true
  },
  // Client Credentials (OAuth 2.0)
  clientId: {
    type: String,
    required: true,
    select: false // Don't return in queries by default
  },
  clientSecret: {
    type: String,
    required: true,
    select: false // Don't return in queries by default
  },
  // Runtime token (auto-managed)
  accessToken: {
    type: String,
    select: false // Don't return in queries by default
  },
  tokenExpiresAt: {
    type: Date,
    select: false // Token expiry timestamp
  },
  lastTokenRefreshAt: {
    type: Date,
    default: null
  },
  apiVersion: {
    type: String,
    default: '2026-01',
    required: true
  },
  webhooks: [{
    topic: {
      type: String,
      required: true
    },
    webhookId: {
      type: String,
      required: true
    }
  }],
  status: {
    type: String,
    enum: ['active', 'inactive', 'error'],
    default: 'active',
    index: true
  },
  lastSyncedAt: {
    type: Date,
    default: null
  },
  syncError: {
    message: String,
    occurredAt: Date
  }
}, {
  timestamps: true
});

// Compound index for organization-scoped queries
shopifyConnectionSchema.index({ organizationId: 1, status: 1 });

// Ensure one connection per organization
shopifyConnectionSchema.index({ organizationId: 1 }, { unique: true });

const ShopifyConnection = mongoose.model('ShopifyConnection', shopifyConnectionSchema);

module.exports = ShopifyConnection;
