'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PurchaseOrder extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      PurchaseOrder.belongsTo(models.GroupOrder, {
        foreignKey: 'group_order_id',
        as: 'groupOrder'
      });
      PurchaseOrder.hasMany(models.PurchaseOrderItem, {
        foreignKey: 'purchase_order_id',
        as: 'purchaseOrderItems'
      });
    }
  }
  PurchaseOrder.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    group_order_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'group_orders',
        key: 'id'
      }
    },
    purchase_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    vendor: {
      type: DataTypes.STRING,
      allowNull: true
    },
    tracking_number: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'PurchaseOrder',
    tableName: 'purchase_orders',
    timestamps: true,
  });
  return PurchaseOrder;
};
