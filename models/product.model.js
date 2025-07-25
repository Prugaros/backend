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
      allowNull: true
    },
    images: {
      type: DataTypes.TEXT, // Stores JSON string of all image URLs, first one is main
      allowNull: true,
      defaultValue: '[]',
      get() {
        const rawValue = this.getDataValue('images');
        console.log("Product.images getter called. Raw value:", rawValue); // Add this log
        try {
          return rawValue ? JSON.parse(rawValue) : [];
        } catch (e) {
          console.error("Error parsing images JSON in getter:", rawValue, e);
          return [];
        }
      },
      set(value) {
        this.setDataValue('images', JSON.stringify(value));
      }
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
    collectionProductOrder: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0 // Default to 0, will be updated to place at top
    },
    product_url: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    brand: {
      type: DataTypes.STRING,
      allowNull: true
    }
    // Timestamps (createdAt, updatedAt) added automatically
  }, {
    sequelize,
    modelName: 'Product',
    tableName: 'products',
    timestamps: true,
  });
  return Product;
};
