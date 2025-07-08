'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('orders', 'shipping_status', {
      type: Sequelize.ENUM('Pending', 'Processing', 'Packed', 'Shipped', 'Delivered', 'Issue'),
      allowNull: true,
      defaultValue: 'Pending'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('orders', 'shipping_status');
  }
};
