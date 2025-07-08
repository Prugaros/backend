module.exports = (sequelize, DataTypes) => {
  const ShipmentIntakeItem = sequelize.define('ShipmentIntakeItem', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    group_order_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    received_quantity: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  }, {
    tableName: 'ShipmentIntakeItem',
    timestamps: false
  });

  ShipmentIntakeItem.associate = (models) => {
    ShipmentIntakeItem.belongsTo(models.GroupOrder, {
      foreignKey: 'group_order_id',
      as: 'groupOrder',
    });
    ShipmentIntakeItem.belongsTo(models.Product, {
      foreignKey: 'product_id',
      as: 'product',
    });
  };

  return ShipmentIntakeItem;
};
