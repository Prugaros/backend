module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('shipment_manifests', 'package_type', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('shipment_manifests', 'package_length', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('shipment_manifests', 'package_width', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('shipment_manifests', 'package_height', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('shipment_manifests', 'total_weight_oz', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });

    // Copy data from ShipmentDetails to ShipmentManifests
    const shipmentDetails = await queryInterface.sequelize.query(
      'SELECT * FROM ShipmentDetails',
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    for (const detail of shipmentDetails) {
      await queryInterface.sequelize.query(
        `UPDATE shipment_manifests SET package_type = '${detail.package_type}', package_length = ${detail.package_length}, package_width = ${detail.package_width}, package_height = ${detail.package_height}, total_weight_oz = ${detail.total_weight_oz} WHERE id = ${detail.shipment_manifest_id}`
      );
    }

    // Remove the ShipmentDetails table
    await queryInterface.dropTable('ShipmentDetails');
  },

  down: async (queryInterface, Sequelize) => {
    // This is the "reverse" operation, to undo the changes.
    // It's more complex, and depends on how you want to handle reverting the data.
    // For simplicity, we'll just recreate the ShipmentDetails table (without data).
    await queryInterface.createTable('ShipmentDetails', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      shipment_manifest_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'ShipmentManifests',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      package_type: {
        type: Sequelize.STRING
      },
      package_length: {
        type: Sequelize.INTEGER
      },
      package_width: {
        type: Sequelize.INTEGER
      },
      package_height: {
        type: Sequelize.INTEGER
      },
      total_weight_oz: {
        type: Sequelize.DECIMAL(10, 2)
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.removeColumn('shipment_manifests', 'package_type');
    await queryInterface.removeColumn('shipment_manifests', 'package_length');
    await queryInterface.removeColumn('shipment_manifests', 'package_width');
    await queryInterface.removeColumn('shipment_manifests', 'package_height');
    await queryInterface.removeColumn('shipment_manifests', 'total_weight_oz');
  }
};
