const db = require('../models');
const Product = db.Product;
const Brand = db.Brand;

const assignBrandIds = async () => {
  try {
    const brands = await Brand.findAll();
    const brandMap = {};
    brands.forEach(brand => {
      brandMap[brand.name] = brand.id;
    });

    const products = await Product.findAll({
      where: {
        brandId: null
      }
    });

    for (const product of products) {
      // This script assumes the old 'brand' column still exists.
      // If you have already run the migration to remove it, this will fail.
      // This is a temporary script to be run BEFORE the final migration.
      const brandName = product.brand;
      if (brandMap[brandName]) {
        product.brandId = brandMap[brandName];
        await product.save();
        console.log(`Updated product ${product.id} with brandId ${product.brandId}`);
      } else {
        console.log(`Could not find brand for product ${product.id} with brand name ${brandName}`);
      }
    }

    console.log('Finished assigning brand IDs.');
  } catch (error) {
    console.error('Error assigning brand IDs:', error);
  } finally {
    db.sequelize.close();
  }
};

assignBrandIds();
