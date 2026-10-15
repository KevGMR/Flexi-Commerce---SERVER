#!/usr/bin/env node
/**
 * Seed storefront content (products, variants, collections, homepage sections)
 * for FLEXI-POS live tenants.
 *
 * Idempotent: every doc uses a "seed-" prefixed handle/slug and a
 * `source: "seed"` marker. Re-running updates in place. `--clean` wipes
 * seed docs for the target org(s) first.
 *
 * Usage:
 *   node scripts/seed-storefront-content.js                 # dry run, both orgs
 *   node scripts/seed-storefront-content.js --apply         # write, both
 *   node scripts/seed-storefront-content.js --apply --clean # wipe seed docs, reseed
 *   node scripts/seed-storefront-content.js --apply --org=house-of-queens
 *   node scripts/seed-storefront-content.js --apply --org=styledke
 */

const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const CLEAN = process.argv.includes("--clean");
const ORG_FILTER = (() => {
  const arg = process.argv.find((a) => a.startsWith("--org="));
  return arg ? arg.slice("--org=".length) : null;
})();

const uri = process.env.PROD_MONGO_URI;
if (!uri) {
  console.error("PROD_MONGO_URI not set in server/.env");
  process.exit(1);
}
const isLocal = /localhost|127\.0\.0\.1/.test(uri);
if (isLocal && !process.argv.includes("--force-local")) {
  console.error("PROD_MONGO_URI looks local. Pass --force-local to override.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Image bank (Unsplash — hotlinkable, real, seed-only)
// ---------------------------------------------------------------------------

const IMG = {
  wig1: "https://images.unsplash.com/photo-1595959183082-7b570b7e08e2?w=1200&q=80",
  wig2: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1200&q=80",
  wig3: "https://images.unsplash.com/photo-1519699047748-de8e457a634e?w=1200&q=80",
  wig4: "https://images.unsplash.com/photo-1580618672591-eb180b1a973f?w=1200&q=80",
  beauty1: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1200&q=80",
  beauty2: "https://images.unsplash.com/photo-1571875257727-256c39da42af?w=1200&q=80",
  beauty3: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1200&q=80",
  beauty4: "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=1200&q=80",
  apparel1: "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1200&q=80",
  apparel2: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&q=80",
  apparel3: "https://images.unsplash.com/photo-1485462537746-965f33f7f6a7?w=1200&q=80",
  apparel4: "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=1200&q=80",
  apparel5: "https://images.unsplash.com/photo-1445205170230-053b83016050?w=1200&q=80",
  apparel6: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1200&q=80",
  lifestyle1: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&q=80",
  lifestyle2: "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1200&q=80",
  banner1: "https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?w=1600&q=80",
  banner2: "https://images.unsplash.com/photo-1607082349566-187342175e2f?w=1600&q=80",
  hero1: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=1600&q=80",
  hero2: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1600&q=80",
};

// ---------------------------------------------------------------------------
// Content plans
// ---------------------------------------------------------------------------

const PLANS = {
  "house-of-queens": {
    skuPrefix: "HOQ",
    currency: "KES",
    products: [
      { handle: "seed-body-wave-lace-front", name: "Body Wave Lace Front Wig", price: 18500, compareAt: 22000, productType: "Wigs", vendor: "House of Queens", tags: ["wigs", "lace-front", "body-wave"], images: [IMG.wig1, IMG.wig2, IMG.wig3], hover: IMG.wig2, options: { name: "Length", values: ['18"', '20"', '22"', '24"'] } },
      { handle: "seed-deep-curly-bundle", name: "Deep Curly Bundle Deal", price: 12400, compareAt: 15000, productType: "Bundles", vendor: "House of Queens", tags: ["bundles", "curly"], images: [IMG.wig2, IMG.wig4], hover: IMG.wig4, options: { name: "Length", values: ['16"', '18"', '20"'] } },
      { handle: "seed-straight-bob", name: "Straight Bob Wig", price: 9800, productType: "Wigs", vendor: "House of Queens", tags: ["wigs", "bob"], images: [IMG.wig3, IMG.wig1], hover: IMG.wig1, options: { name: "Length", values: ['10"', '12"', '14"'] } },
      { handle: "seed-kinky-straight", name: "Kinky Straight Closure", price: 7200, productType: "Closures", vendor: "House of Queens", tags: ["closures", "kinky"], images: [IMG.wig4, IMG.wig3], hover: IMG.wig3, options: { name: "Length", values: ['12"', '14"'] } },
      { handle: "seed-hd-lace-frontal", name: "HD Lace Frontal", price: 8600, compareAt: 9900, productType: "Frontals", vendor: "House of Queens", tags: ["frontals", "hd-lace"], images: [IMG.beauty1, IMG.beauty2], hover: IMG.beauty2, options: { name: "Size", values: ["13x4", "13x6"] } },
      { handle: "seed-edge-control-gel", name: "Edge Control Gel", price: 850, productType: "Accessories", vendor: "House of Queens", tags: ["accessories", "edge"], images: [IMG.beauty3, IMG.beauty4], hover: IMG.beauty4, options: null },
      { handle: "seed-wig-cap", name: "Comfort Wig Cap", price: 450, productType: "Accessories", vendor: "House of Queens", tags: ["accessories"], images: [IMG.beauty4, IMG.beauty3], hover: IMG.beauty3, options: null },
      { handle: "seed-silk-bonnet", name: "Silk Sleep Bonnet", price: 1200, productType: "Accessories", vendor: "House of Queens", tags: ["accessories", "silk"], images: [IMG.beauty2, IMG.beauty1], hover: IMG.beauty1, options: null },
    ],
    collections: [
      { slug: "seed-wigs", name: "Wigs", description: "Lace front, closure, and full wigs ready to wear.", image: IMG.wig1, products: ["seed-body-wave-lace-front", "seed-straight-bob"] },
      { slug: "seed-bundles", name: "Bundles & Deals", description: "Hair bundles and value deals.", image: IMG.wig2, products: ["seed-deep-curly-bundle", "seed-kinky-straight"] },
      { slug: "seed-accessories", name: "Accessories", description: "Everything else you need.", image: IMG.beauty3, products: ["seed-edge-control-gel", "seed-wig-cap", "seed-silk-bonnet"] },
    ],
    sections: [
      { type: "hero", config: { heading: "Crown yourself", subheading: "Premium wigs, bundles, and accessories — delivered across Kenya.", ctaLabel: "Shop wigs", ctaHref: "/products", imageUrl: IMG.hero1, align: "left" } },
      { type: "trust-strip", config: { items: [ { title: "Fast delivery", body: "Same-day in Nairobi" }, { title: "Secure M-Pesa", body: "Pay safely at checkout" }, { title: "Real hair", body: "100% virgin human hair" } ] } },
      { type: "featured-category", config: { heading: "Shop by category", subheading: "Find your next look", categorySlugs: ["seed-wigs", "seed-bundles", "seed-accessories"] } },
      { type: "featured-products", config: { heading: "Bestsellers", subheading: "What everyone is loving", mode: "latest", productIds: [], limit: 8 } },
      { type: "image-text", config: { heading: "Quality you can feel", subheading: "Our promise", body: "Every unit is hand-selected and inspected before it ships.\nWe only sell hair we would wear ourselves.", imageUrl: IMG.lifestyle1, imagePosition: "left", ctaLabel: "Read our story", ctaHref: "/about" } },
      { type: "banner", config: { imageUrl: IMG.banner1, href: "/collections", alt: "Sale banner" } },
      { type: "collection", config: { heading: "New arrivals", subheading: "Fresh in this week", collectionSlug: "seed-wigs", limit: 4 } },
      { type: "rich-text", config: { heading: "Visit our studio", body: "Walk in for a fitting at our Nairobi studio, or order online and we'll deliver to your door." } },
    ],
  },

  styledke: {
    skuPrefix: "SK",
    currency: "KES",
    products: [
      { handle: "seed-linen-shirt", name: "Relaxed Linen Shirt", price: 3800, compareAt: 4500, productType: "Shirts", vendor: "StyledKE", tags: ["shirts", "linen"], images: [IMG.apparel1, IMG.apparel2], hover: IMG.apparel2, options: { name: "Size", values: ["S", "M", "L", "XL"] } },
      { handle: "seed-wide-leg-trouser", name: "Wide-Leg Trouser", price: 4200, productType: "Trousers", vendor: "StyledKE", tags: ["trousers"], images: [IMG.apparel3, IMG.apparel4], hover: IMG.apparel4, options: { name: "Size", values: ["28", "30", "32", "34"] } },
      { handle: "seed-midi-dress", name: "Floral Midi Dress", price: 5600, compareAt: 6800, productType: "Dresses", vendor: "StyledKE", tags: ["dresses", "floral"], images: [IMG.apparel5, IMG.apparel6], hover: IMG.apparel6, options: { name: "Size", values: ["XS", "S", "M", "L"] } },
      { handle: "seed-denim-jacket", name: "Classic Denim Jacket", price: 6200, productType: "Outerwear", vendor: "StyledKE", tags: ["outerwear", "denim"], images: [IMG.apparel2, IMG.apparel1], hover: IMG.apparel1, options: { name: "Size", values: ["S", "M", "L"] } },
      { handle: "seed-cotton-tee", name: "Essential Cotton Tee", price: 1500, productType: "Tops", vendor: "StyledKE", tags: ["tops", "basics"], images: [IMG.apparel4, IMG.apparel3], hover: IMG.apparel3, options: { name: "Size", values: ["S", "M", "L", "XL"] } },
      { handle: "seed-leather-belt", name: "Leather Belt", price: 2200, productType: "Accessories", vendor: "StyledKE", tags: ["accessories"], images: [IMG.apparel6, IMG.apparel5], hover: IMG.apparel5, options: null },
      { handle: "seed-canvas-tote", name: "Canvas Tote Bag", price: 2800, productType: "Bags", vendor: "StyledKE", tags: ["bags"], images: [IMG.lifestyle2, IMG.lifestyle1], hover: IMG.lifestyle1, options: null },
      { handle: "seed-silk-scarf", name: "Printed Silk Scarf", price: 1900, productType: "Accessories", vendor: "StyledKE", tags: ["accessories", "silk"], images: [IMG.apparel5, IMG.apparel6], hover: IMG.apparel6, options: null },
    ],
    collections: [
      { slug: "seed-new-in", name: "New In", description: "Just landed.", image: IMG.apparel1, products: ["seed-linen-shirt", "seed-midi-dress", "seed-cotton-tee"] },
      { slug: "seed-essentials", name: "Essentials", description: "Everyday pieces.", image: IMG.apparel4, products: ["seed-cotton-tee", "seed-wide-leg-trouser", "seed-leather-belt"] },
      { slug: "seed-outerwear", name: "Outerwear", description: "Layer up.", image: IMG.apparel2, products: ["seed-denim-jacket"] },
    ],
    sections: [
      { type: "hero", config: { heading: "Wear it your way", subheading: "Contemporary Kenyan fashion, delivered.", ctaLabel: "Shop new in", ctaHref: "/products", imageUrl: IMG.hero2, align: "left" } },
      { type: "trust-strip", config: { items: [ { title: "Free returns", body: "Within 7 days" }, { title: "M-Pesa", body: "Pay at checkout" }, { title: "Nairobi-made", body: "Local designers" } ] } },
      { type: "featured-category", config: { heading: "Browse", subheading: "Pick a category", categorySlugs: ["seed-new-in", "seed-essentials", "seed-outerwear"] } },
      { type: "featured-products", config: { heading: "Trending now", subheading: "", mode: "latest", productIds: [], limit: 8 } },
      { type: "image-text", config: { heading: "Made in Nairobi", subheading: "Our story", body: "We work with local designers and small ateliers to bring you pieces that last.", imageUrl: IMG.lifestyle2, imagePosition: "right", ctaLabel: "About us", ctaHref: "/about" } },
      { type: "banner", config: { imageUrl: IMG.banner2, href: "/collections", alt: "Seasonal banner" } },
      { type: "collection", config: { heading: "New this week", collectionSlug: "seed-new-in", limit: 4 } },
      { type: "rich-text", config: { heading: "Delivery across Kenya", body: "Nairobi same-day. Countrywide 2–3 days via courier." } },
    ],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const newId = () => new mongoose.Types.ObjectId();
const slugVariant = (s) => (s || "default").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function buildImages(urls, hoverUrl) {
  if (!Array.isArray(urls) || urls.length === 0) return [];
  const out = [];
  // First image is default. Hover image (if different) becomes a second
  // non-default image so it survives the round-trip through the API.
  urls.forEach((url, i) => {
    out.push({ url, alt: "", isDefault: i === 0, pendingUpload: false });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Clean
// ---------------------------------------------------------------------------

async function cleanSeedDocs({ db, orgId }) {
  const filter = { organizationId: orgId, source: "seed" };
  const p = await db.collection("products").deleteMany(filter);
  const v = await db.collection("variants").deleteMany(filter);
  const c = await db.collection("collections").deleteMany(filter);
  console.log(
    `    clean    products=${p.deletedCount}  variants=${v.deletedCount}  collections=${c.deletedCount}`,
  );
}

// ---------------------------------------------------------------------------
// Upserts
// ---------------------------------------------------------------------------

async function upsertProduct({ db, orgId, currency, spec, seq, skuPrefix }) {
  const products = db.collection("products");
  const existing = await products.findOne({
    organizationId: orgId,
    handle: spec.handle,
  });
  const _id = existing?._id || newId();
  const sku = `${skuPrefix}-SEED-${String(seq).padStart(3, "0")}`;
  const cost = Math.round(spec.price * 0.4);

  const doc = {
    _id,
    organizationId: orgId,
    name: spec.name,
    handle: spec.handle,
    description: spec.description || `${spec.name} — quality you can trust.`,
    productType: spec.productType || "",
    vendor: spec.vendor || "",
    tags: spec.tags || [],
    sku,
    type: "physical",
    serviceKind: "single",
    status: "active",
    published: true,
    publishedAt: existing?.publishedAt || new Date(),
    price: spec.price,
    compareAtPrice: spec.compareAt ?? null,
    cost,
    currency,
    weight: 0,
    weightUnit: "kg",
    trackInventory: true,
    options: spec.options
      ? [{ name: spec.options.name, position: 0, values: spec.options.values }]
      : [],
    images: buildImages(spec.images, spec.hover),
    metafields: [],
    metafieldDefinitions: [],
    migrationFlags: [],
    source: "seed",
    updatedAt: new Date(),
    createdAt: existing?.createdAt || new Date(),
  };

  if (APPLY) {
    await products.updateOne({ _id }, { $set: doc }, { upsert: true });
  }
  return { _id, sku, doc };
}

async function upsertVariants({ db, orgId, product, spec }) {
  const variants = db.collection("variants");
  const optionName = spec.options?.name || "Title";
  const optionValues = spec.options?.values?.length
    ? spec.options.values
    : ["Default"];

  const written = [];
  for (let i = 0; i < optionValues.length; i++) {
    const value = optionValues[i];
    const vSku = `${product.sku}-${slugVariant(value)}`.toUpperCase();
    const existing = await variants.findOne({
      organizationId: orgId,
      sku: vSku,
    });
    const _id = existing?._id || newId();

    const doc = {
      _id,
      organizationId: orgId,
      productId: product._id,
      sku: vSku,
      sourceSku: null,
      selectedOptions: [{ name: optionName, value }],
      price: spec.price,
      compareAtPrice: spec.compareAt ?? null,
      cost: Math.round(spec.price * 0.4),
      weight: 0,
      weightUnit: "kg",
      images: buildImages(spec.images, spec.hover).slice(0, 1),
      metafields: [],
      position: i,
      status: "active",
      trackInventory: true,
      continueSellingWhenOutOfStock: false,
      source: "seed",
      updatedAt: new Date(),
      createdAt: existing?.createdAt || new Date(),
    };

    if (APPLY) {
      await variants.updateOne({ _id }, { $set: doc }, { upsert: true });
    }
    written.push({ sku: vSku, _id });
  }
  return written;
}

async function upsertCollection({ db, orgId, spec, productIdByHandle }) {
  const collections = db.collection("collections");
  const existing = await collections.findOne({
    organizationId: orgId,
    slug: spec.slug,
  });
  const _id = existing?._id || newId();

  const productIds = (spec.products || [])
    .map((h) => productIdByHandle.get(h))
    .filter(Boolean);

  const doc = {
    _id,
    organizationId: orgId,
    name: spec.name,
    slug: spec.slug,
    description: spec.description || "",
    parentCollectionId: null,
    type: "manual",
    rules: [],
    ruleLogic: "AND",
    productIds,
    image: spec.image ? { url: spec.image, alt: spec.name } : undefined,
    status: "active",
    published: true,
    publishedAt: existing?.publishedAt || new Date(),
    source: "seed",
    updatedAt: new Date(),
    createdAt: existing?.createdAt || new Date(),
  };

  if (APPLY) {
    await collections.updateOne({ _id }, { $set: doc }, { upsert: true });
  }
  return { _id, productIds };
}

async function backfillProductCollectionIds({ db, orgId, collectionsByProductId }) {
  const products = db.collection("products");
  for (const [productId, collectionIds] of collectionsByProductId.entries()) {
    if (APPLY) {
      await products.updateOne(
        { _id: productId, organizationId: orgId },
        { $set: { collectionIds, updatedAt: new Date() } },
      );
    }
  }
}

async function setHomepageSections({ db, orgId, sections }) {
  const orgs = db.collection("organizations");
  const withIds = sections.map((s) => ({
    id: `seed-${s.type}-${Math.random().toString(36).slice(2, 8)}`,
    type: s.type,
    config: s.config || {},
  }));

  if (APPLY) {
    await orgs.updateOne(
      { _id: orgId },
      {
        $set: {
          "website.homepage.sections": withIds,
          updatedAt: new Date(),
        },
      },
    );
  }
  return withIds.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log(`Mode:  ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}${CLEAN ? " + CLEAN" : ""}`);
  console.log(`URI:   ${isLocal ? "LOCAL" : "REMOTE (prod)"}`);
  console.log(`Orgs:  ${ORG_FILTER || "house-of-queens, styledke"}\n`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const orgs = db.collection("organizations");

  const targets = ORG_FILTER ? [ORG_FILTER] : ["house-of-queens", "styledke"];

  for (const slug of targets) {
    const org = await orgs.findOne({ "website.subdomain": slug });
    if (!org) {
      console.error(`  ✗ Org not found for subdomain: ${slug}`);
      continue;
    }
    const plan = PLANS[slug];
    if (!plan) {
      console.error(`  ✗ No plan defined for ${slug}`);
      continue;
    }

    console.log(`▸ ${slug}  [${org.name}]  orgId=${org._id}`);

    if (CLEAN) {
      await cleanSeedDocs({ db, orgId: org._id });
    }

    const productIdByHandle = new Map();
    let seq = 0;
    for (const spec of plan.products) {
      seq += 1;
      const product = await upsertProduct({
        db,
        orgId: org._id,
        currency: plan.currency,
        spec,
        seq,
        skuPrefix: plan.skuPrefix,
      });
      productIdByHandle.set(spec.handle, product._id);
      const variants = await upsertVariants({
        db,
        orgId: org._id,
        product,
        spec,
      });
      console.log(
        `    product  ${spec.handle}  sku=${product.sku}  variants=${variants.length}`,
      );
    }

    const collectionsByProductId = new Map();
    for (const spec of plan.collections) {
      const coll = await upsertCollection({
        db,
        orgId: org._id,
        spec,
        productIdByHandle,
      });
      for (const pid of coll.productIds) {
        if (!collectionsByProductId.has(pid)) {
          collectionsByProductId.set(pid, []);
        }
        collectionsByProductId.get(pid).push(coll._id);
      }
      console.log(
        `    collect  ${spec.slug}  products=${coll.productIds.length}`,
      );
    }

    await backfillProductCollectionIds({
      db,
      orgId: org._id,
      collectionsByProductId,
    });

    const n = await setHomepageSections({
      db,
      orgId: org._id,
      sections: plan.sections,
    });
    console.log(`    sections ${n} written\n`);
  }

  await mongoose.disconnect();
  console.log(APPLY ? "Done (applied)." : "Done (dry run — pass --apply to write).");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});