'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class OrderItem extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // OrderItem belongs to one Order
      OrderItem.belongsTo(models.Order, {
        foreignKey: 'order_id',
        as: 'order' // Alias
      });
      // OrderItem belongs to one Product
      OrderItem.belongsTo(models.Product, {
        foreignKey: 'product_id',
        as: 'product' // Alias
      });
    }
  }
  OrderItem.init({
    id: { // Optional primary key for the join table itself
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    order_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'orders', // Table name
        key: 'id'
      },
      // primaryKey: true // Use composite primary key if no separate id
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'products', // Table name
        key: 'id'
      },
      // primaryKey: true // Use composite primary key if no separate id
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    price_at_order_time: { // Store the price when the order was made
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    }
    // Timestamps can be enabled if needed: timestamps: true
  }, {
    sequelize,
    modelName: 'OrderItem',
    tableName: 'order_items',
    timestamps: true // Enable timestamps to know when items were added/updated
  });
  return OrderItem;
};
