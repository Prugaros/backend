'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Product extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // Products belong to many GroupOrders through GroupOrderItems
      Product.belongsToMany(models.GroupOrder, {
        through: 'GroupOrderItem', // Name of the join table model
        foreignKey: 'product_id',
        otherKey: 'group_order_id',
        as: 'groupOrders' // Alias for the association
      });
      // Products belong to many Orders through OrderItems
      Product.belongsToMany(models.Order, {
        through: 'OrderItem', // Name of the join table model
        foreignKey: 'product_id',
        otherKey: 'order_id',
        as: 'orders' // Alias for the association
      });
    }
  }
  Product.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    price: {
      type: DataTypes.DECIMAL(10, 2), // Example: 10 total digits, 2 after decimal
      allowNull: false
    },
    image_url: {
      type: DataTypes.STRING, // URL pointing to S3
      allowNull: true
    },
    weight_oz: {
      type: DataTypes.DECIMAL(10, 2), // Example: Weight in ounces
      allowNull: true // Or false if always required
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true // Default new products to active
    },
    MSRP: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    collectionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Collections',
        key: 'id',
      }
    },
    // Timestamps (createdAt, updatedAt) added automatically
  }, {
    sequelize,
    modelName: 'Product',
    tableName: 'products',
    timestamps: true,
  });
  return Product;
};
