'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ShipmentManifest extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // ShipmentManifest belongs to one GroupOrder
      ShipmentManifest.belongsTo(models.GroupOrder, {
        foreignKey: 'group_order_id',
        as: 'groupOrder'
      });
      // ShipmentManifest belongs to one Customer
      ShipmentManifest.belongsTo(models.Customer, {
        foreignKey: 'customer_id',
        as: 'customer'
      });
    }
  }
  ShipmentManifest.init({
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
    customer_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'customers',
        key: 'id'
      }
    },
    order_ids: {
      type: DataTypes.JSON, // Store an array of order IDs
      allowNull: false
    },
    manual_override: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    packed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    package_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    package_length: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    package_width: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    package_height: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    total_weight_oz: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    }
  }, {
    sequelize,
    modelName: 'ShipmentManifest',
    tableName: 'shipment_manifests',
    timestamps: true,
  });
  return ShipmentManifest;
};
