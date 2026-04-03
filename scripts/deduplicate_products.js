'use strict';

const { 
  sequelize, 
  Product, 
  OrderItem, 
  Inventory, 
  PurchaseOrderItem, 
  ShipmentIntakeItem, 
  GroupOrderItem, 
  InventoryHistory, 
  Refund 
} = require('../models');

const dryRun = process.argv.includes('--dry-run');

async function deduplicate() {
  const transaction = await sequelize.transaction();
  try {
    const products = await Product.findAll({ transaction });
    const slugMap = new Map();

    // Group by slug
    products.forEach(p => {
      try {
        let urlStr = p.product_url;
        // Normalize Disney domain migration
        if (urlStr.includes('store.disney.co.jp')) {
          urlStr = urlStr.replace('store.disney.co.jp', 'shopdisney.disney.co.jp');
        }

        const urlObj = new URL(urlStr);
        let pathname = urlObj.pathname;
        if (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
        const parts = pathname.split('/');
        const slug = parts[parts.length - 1];
        
        if (!slugMap.has(slug)) {
          slugMap.set(slug, []);
        }
        // Store both the original product and the normalized URL
        slugMap.get(slug).push({ p, normalizedUrl: urlStr });
      } catch (e) {
        console.warn(`Skipping invalid URL for product ${p.id}: ${p.product_url}`);
      }
    });

    console.log(`Processing ${slugMap.size} unique slugs from ${products.length} product records...`);
    if (dryRun) console.log('--- DRY RUN MODE ---');

    for (const [slug, items] of slugMap) {
      const prods = items.map(i => i.p);

      // Sort prods to pick canonical:
      // 1. Has most OrderItems
      // 2. Has Inventory
      // 3. Lowest ID
      const prodsWithStats = await Promise.all(prods.map(async p => {
        const orderCount = await OrderItem.count({ where: { product_id: p.id }, transaction });
        const inv = await Inventory.findOne({ where: { productId: p.id }, transaction });
        return { 
          p, 
          orderCount, 
          hasInventory: !!inv, 
          invQty: inv ? inv.quantityInStock : 0 
        };
      }));

      prodsWithStats.sort((a, b) => {
        if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
        if (b.hasInventory !== a.hasInventory) return b.hasInventory ? 1 : -1;
        return a.p.id - b.p.id;
      });

      const canonical = prodsWithStats[0];
      const duplicates = prodsWithStats.slice(1);

      // Normalize URL for canonical using the prioritized normalizedUrl from its group
      // Actually, we should use the normalized version of the canonical's URL
      const matchingItem = items.find(i => i.p.id === canonical.p.id);
      let targetUrl = matchingItem.normalizedUrl;

      const urlObj = new URL(targetUrl);
      const origin = urlObj.origin;
      
      const isShopifyStandard = targetUrl.includes('/products/');
      if (isShopifyStandard) {
        targetUrl = `${origin}/products/${slug}`;
      }

      // If it's a recognized long Shopify path, force normalize
      if (targetUrl.includes('/collections/') && targetUrl.includes('/products/')) {
        targetUrl = `${origin}/products/${slug}`;
      }

      if (duplicates.length > 0) {
        console.log(`Merging ${duplicates.length} duplicates for slug: ${slug} (Keep ID: ${canonical.p.id})`);
        
        let totalInvQty = canonical.invQty;

        for (const dup of duplicates) {
          console.log(`  - Duplicate ID: ${dup.p.id}, Orders: ${dup.orderCount}, Inventory: ${dup.invQty}`);
          
          totalInvQty += dup.invQty;

          // Update foreign keys
          if (!dryRun) {
            await OrderItem.update({ product_id: canonical.p.id }, { where: { product_id: dup.p.id }, transaction });
            await InventoryHistory.update({ productId: canonical.p.id }, { where: { productId: dup.p.id }, transaction });
            await PurchaseOrderItem.update({ product_id: canonical.p.id }, { where: { product_id: dup.p.id }, transaction });
            await ShipmentIntakeItem.update({ product_id: canonical.p.id }, { where: { product_id: dup.p.id }, transaction });
            if (GroupOrderItem) {
                await GroupOrderItem.update({ product_id: canonical.p.id }, { where: { product_id: dup.p.id }, transaction });
            }
            if (Refund) {
                await Refund.update({ product_id: canonical.p.id }, { where: { product_id: dup.p.id }, transaction });
            }

            // Delete dup inventory
            await Inventory.destroy({ where: { productId: dup.p.id }, transaction });
            // Delete dup product
            await Product.destroy({ where: { id: dup.p.id }, transaction });
          }
        }

        // Update canonical inventory
        if (totalInvQty !== canonical.invQty) {
          console.log(`  - Updating Inventory for ID ${canonical.p.id}: ${canonical.invQty} -> ${totalInvQty}`);
          if (!dryRun) {
            let inv = await Inventory.findOne({ where: { productId: canonical.p.id }, transaction });
            if (!inv) {
                await Inventory.create({ productId: canonical.p.id, quantityInStock: totalInvQty }, { transaction });
            } else {
                await inv.update({ quantityInStock: totalInvQty }, { transaction });
            }
          }
        }
      }

      // NOW update URL for canonical
      if (canonical.p.product_url !== targetUrl) {
        console.log(`Updating URL for product ${canonical.p.id}: ${canonical.p.product_url} -> ${targetUrl}`);
        if (!dryRun) {
          await Product.update({ product_url: targetUrl }, { where: { id: canonical.p.id }, transaction });
        }
      }
    }

    if (dryRun) {
      console.log('Dry run complete. No changes were committed.');
      await transaction.rollback();
    } else {
      await transaction.commit();
      console.log('Deduplication and normalization complete.');
    }

  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error('Error during deduplication:', error);
    process.exit(1);
  }
}

deduplicate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
