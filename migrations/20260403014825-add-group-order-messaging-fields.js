'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('group_orders', 'email_custom_message', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('group_orders', 'facebook_image_url', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('group_orders', 'email_image_url', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('group_orders', 'email_custom_message');
    await queryInterface.removeColumn('group_orders', 'facebook_image_url');
    await queryInterface.removeColumn('group_orders', 'email_image_url');
  }
};
