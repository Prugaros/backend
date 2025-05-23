'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class GroupOrderItem extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // Define associations if needed, though often not necessary for simple join tables
      // Example: If you needed to access the GroupOrder or Product directly from an instance
      // GroupOrderItem.belongsTo(models.GroupOrder, { foreignKey: 'group_order_id' });
      // GroupOrderItem.belongsTo(models.Product, { foreignKey: 'product_id' });
    }
  }
  GroupOrderItem.init({
    id: { // Optional primary key for the join table itself
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    group_order_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'group_orders', // Table name
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
    }
    // No additional fields needed for this join table usually
    // Timestamps can be disabled if not needed: timestamps: false
  }, {
    sequelize,
    modelName: 'GroupOrderItem',
    tableName: 'group_order_items',
    timestamps: false // Often timestamps aren't needed on simple join tables
  });
  return GroupOrderItem;
};
