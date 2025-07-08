'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
// Correctly reference the config file relative to this index.js file
const config = require(path.join(__dirname, '/../config/database.js'))[env];
const db = {};

let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

// Test the connection
sequelize
  .authenticate()
  .then(() => {
    console.log('Database connection has been established successfully.');
  })
  .catch(err => {
    console.error('Unable to connect to the database:', err);
    // Optionally exit if connection fails critically during startup
    // process.exit(1);
  });


fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    // Use require for model definition function
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

const Collection = require(path.join(__dirname, 'collection.model.js'))(sequelize, Sequelize.DataTypes);
db[Collection.name] = Collection;

const PurchaseOrder = require(path.join(__dirname, 'purchaseOrder.model.js'))(sequelize, Sequelize.DataTypes);
db[PurchaseOrder.name] = PurchaseOrder;

const PurchaseOrderItem = require(path.join(__dirname, 'purchaseOrderItem.model.js'))(sequelize, Sequelize.DataTypes);
db[PurchaseOrderItem.name] = PurchaseOrderItem;

const Inventory = require(path.join(__dirname, 'inventory.model.js'))(sequelize, Sequelize.DataTypes);
db[Inventory.name] = Inventory;

const ShipmentIntakeItem = require(path.join(__dirname, 'shipmentIntakeItem.model.js'))(sequelize, Sequelize.DataTypes);
db[ShipmentIntakeItem.name] = ShipmentIntakeItem;


const InventoryHistory = require(path.join(__dirname, 'inventoryHistory.model.js'))(sequelize, Sequelize.DataTypes);
db[InventoryHistory.name] = InventoryHistory;

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.ShipmentIntakeItem.belongsTo(db.GroupOrder, {
  foreignKey: 'group_order_id',
  as: 'shipmentIntakeGroupOrder'
});

db.ShipmentIntakeItem.belongsTo(db.Product, {
  foreignKey: 'product_id',
  as: 'shipmentIntakeProduct'
});

db.Product.hasOne(db.Inventory, {
  foreignKey: 'productId',
  as: 'inventory'
});

db.Product.hasMany(db.InventoryHistory, {
  foreignKey: 'productId',
  as: 'inventoryHistory'
});

db.Inventory.belongsTo(db.Product, {
  foreignKey: 'productId',
  as: 'inventoryproduct'
});

db.InventoryHistory.belongsTo(db.Product, {
  foreignKey: 'productId',
  as: 'inventoryHistoyProduct'
});

db.Product.belongsTo(db.Collection, {
  foreignKey: 'collectionId',
  as: 'collection',
});

db.PurchaseOrder.belongsTo(db.GroupOrder, {
  foreignKey: 'group_order_id',
  as: 'purchaseOrderGroupOrder'
});

db.PurchaseOrderItem.belongsTo(db.PurchaseOrder, {
  foreignKey: 'purchase_order_id',
  as: 'purchaseOrderItems'
});

db.PurchaseOrderItem.belongsTo(db.Product, {
  foreignKey: 'product_id',
  as: 'product',
  include: { model: db.Product, as: 'purchasedProduct' }
});

db.sequelize = sequelize;

module.exports = db;
