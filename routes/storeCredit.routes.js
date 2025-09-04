const authJwt = require("../middleware/authJwt.js");
const controller = require("../controllers/storeCredit.controller");

module.exports = function(app) {
  app.use(function(req, res, next) {
    res.header(
      "Access-Control-Allow-Headers",
      "x-access-token, Origin, Content-Type, Accept"
    );
    next();
  });

  app.post(
    "/api/store-credit",
    [authJwt.verifyToken],
    controller.addStoreCredit
  );

  app.get(
    "/api/store-credit/all-customers",
    [authJwt.verifyToken],
    controller.getAllCustomersWithStoreCredit
  );

  app.get(
    "/api/store-credit/:customer_id",
    [authJwt.verifyToken],
    controller.getStoreCreditByCustomer
  );
};
