import json
import os

os.chdir(r"C:\Users\Kev\Documents\FLEXI-POS\server")

# Read all 4 collections
file_names = [
    "FLEXI-POS Multi-Tenant Auth & Organizations.postman_collection.json",
    "FLEXI-POS E-Commerce CRUD APIs.postman_collection.json",
    "FLEXI-POS Sales (Dual Catalog).postman_collection.json",
    "FLEXI-POS Shopify Integration.postman_collection.json"
]

# Load all collections
loaded_collections = []
for fname in file_names:
    try:
        with open(fname, 'r', encoding='utf-8') as f:
            data = json.load(f)
            loaded_collections.append(data)
            print(f"✓ Loaded {fname}: {len(data.get('item', []))} items")
    except Exception as e:
        print(f"✗ Error loading {fname}: {e}")

# Create master collection
master = {
    "info": {
        "_postman_id": "master-flexi-pos-collection",
        "name": "FLEXI-POS Master API Collection",
        "description": "Comprehensive consolidated Postman collection for FLEXI-POS APIs. Includes authentication, E-commerce CRUD, sales operations, and Shopify integration.",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        "_exporter_id": "51601913"
    },
    "item": [],
    "variable": [
        {"key": "baseUrl", "value": "http://localhost:9200", "type": "string"},
        {"key": "accessToken", "value": "", "type": "string"},
        {"key": "token", "value": "", "type": "string"},
        {"key": "organizationId", "value": "", "type": "string"},
        {"key": "userId", "value": "", "type": "string"},
        {"key": "locationId", "value": "", "type": "string"},
        {"key": "productId", "value": "", "type": "string"},
        {"key": "variantId", "value": "", "type": "string"},
        {"key": "collectionId", "value": "", "type": "string"},
        {"key": "supplierId", "value": "", "type": "string"},
        {"key": "purchaseOrderId", "value": "", "type": "string"},
        {"key": "transferId", "value": "", "type": "string"},
        {"key": "giftCardId", "value": "", "type": "string"},
        {"key": "saleId", "value": "", "type": "string"},
        {"key": "receiptNumber", "value": "", "type": "string"}
    ]
}

# Category names in order
categories = [
    "1. Authentication & Organizations",
    "2. E-Commerce CRUD",
    "3. Sales Operations",
    "4. Shopify Integration"
]

# Create folder structure
for i, category in enumerate(categories):
    master["item"].append({
        "name": category,
        "item": []
    })

# Map items to categories
category_keywords = {
    "1. Authentication & Organizations": ["auth", "organization", "user", "email", "invitation", "logout", "session"],
    "2. E-Commerce CRUD": ["product", "variant", "collection", "location", "inventory", "supplier", "purchase", "transfer", "gift"],
    "3. Sales Operations": ["sale", "void", "refund", "summary"],
    "4. Shopify Integration": ["shopify"]
}

# Collect all items
all_items = []
for coll in loaded_collections:
    for item in coll.get("item", []):
        all_items.append(item)

print(f"\nTotal items before categorization: {len(all_items)}")

# Categorize items
categorized = {cat: [] for cat in categories}
uncategorized = []

for item in all_items:
    name_lower = item.get("name", "").lower()
    categorized_flag = False
    
    for category, keywords in category_keywords.items():
        if any(kw in name_lower for kw in keywords):
            categorized[category].append(item)
            categorized_flag = True
            break
    
    if not categorized_flag:
        uncategorized.append(item)

# Add categorized items to master
for i, category in enumerate(categories):
    master["item"][i]["item"].extend(categorized[category])
    print(f"✓ {category}: {len(categorized[category])} requests")

if uncategorized:
    print(f"⚠ Uncategorized: {len(uncategorized)} requests")
    master["item"].append({
        "name": "5. Uncategorized",
        "item": uncategorized
    })

# Save master collection
with open("POSTMAN_MASTER_COLLECTION.json", 'w', encoding='utf-8') as f:
    json.dump(master, f, indent=2)
    print(f"\n✓ Master collection created: POSTMAN_MASTER_COLLECTION.json")
    total = sum(len(master["item"][i]["item"]) for i in range(len(master["item"])))
    print(f"  Total requests: {total}")
