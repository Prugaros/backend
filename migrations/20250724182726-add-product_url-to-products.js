'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'product_url', {
      type: Sequelize.STRING,
      allowNull: true, // Temporarily allow nulls
      unique: false,    // Cannot add unique constraint directly
    });

    // If you have existing data, you might need to populate the new column here
    // before adding the NOT NULL and UNIQUE constraints.
    // For a new table or an empty one, you can proceed directly.

    // Add a unique index
    await queryInterface.addIndex('products', ['product_url'], {
      unique: true,
      name: 'unique_product_url'
    });

    // If needed, alter the column to be NOT NULL after populating it
    await queryInterface.changeColumn('products', 'product_url', {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeIndex('products', 'unique_product_url');
    await queryInterface.removeColumn('products', 'product_url');
  }
};
