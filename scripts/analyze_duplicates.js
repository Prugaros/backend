const { Product, OrderItem, Inventory, PurchaseOrderItem, ShipmentIntakeItem, GroupOrderItem, InventoryHistory, Refund } = require('../models');

async function analyzeDuplicates() {
  const products = await Product.findAll();
  const slugMap = new Map();

  products.forEach(p => {
    const parts = p.product_url.split('/');
    const slug = parts[parts.length - 1];
    if (!slugMap.has(slug)) {
      slugMap.set(slug, []);
    }
    slugMap.get(slug).push(p);
  });

  const duplicates = Array.from(slugMap.entries()).filter(([slug, prods]) => prods.length > 1);

  console.log(`Found ${duplicates.length} duplicate slugs.`);

  for (const [slug, prods] of duplicates) {
    console.log(`Slug: ${slug}`);
    for (const p of prods) {
      const orderCount = await OrderItem.count({ where: { product_id: p.id } });
      const inventory = await Inventory.findOne({ where: { productId: p.id } });
      console.log(`  - ID: ${p.id}, URL: ${p.product_url}, Orders: ${orderCount}, Inventory: ${inventory ? inventory.quantityInStock : 0}`);
    }
  }
}

analyzeDuplicates()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
