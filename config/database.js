require('dotenv').config(); // Ensure environment variables are loaded
const path = require('path');

module.exports = {
  development: {
    dialect: 'sqlite',
    storage: './dev_database.sqlite', // Path to the database file (will be created in backend/)
    logging: false,
    // logging: console.log, // Log SQL queries during development (optional)
    // SQLite does not use username/password/host
    // dialectOptions: { // Example for SQLite if needed
    //   ssl: { // Example for RDS requiring SSL
    //     require: true,
    //     rejectUnauthorized: false // Adjust based on your RDS SSL setup
    //   }
    // }
  },
  test: {
    // Configuration for a test database (if needed)
    username: process.env.DB_USER_TEST || process.env.DB_USER,
    password: process.env.DB_PASSWORD_TEST || process.env.DB_PASSWORD,
    database: process.env.DB_NAME_TEST || 'test_db',
    host: process.env.DB_HOST_TEST || '127.0.0.1',
    dialect: 'mysql',
    logging: false,
  },
  production: {
    dialect: 'sqlite',
    storage: './dev_database.sqlite', // Path to the database file (will be created in backend/)
    // logging: console.log, // Log SQL queries during development (optional)
    // SQLite does not use username/password/host
    // dialectOptions: { // Example for SQLite if needed
    //   ssl: { // Example for RDS requiring SSL
    //     require: true,
    //     rejectUnauthorized: false // Adjust based on your RDS SSL setup
    //   }
    // }
  },
};
