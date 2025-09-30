const authJwt = require("../middleware/authJwt.js");
const controller = require("../controllers/customer.controller");

module.exports = function(app) {
  app.use(function(req, res, next) {
    res.header(
      "Access-Control-Allow-Headers",
      "x-access-token, Origin, Content-Type, Accept"
    );
    next();
  });

  app.get(
    "/api/customers/destash-list",
    [authJwt.verifyToken],
    controller.getDestashList
  );

  app.get(
    "/api/customers/status/:psid",
    controller.getCustomerStatus
  );

  app.patch(
    "/api/customers/destash-notification/:psid",
    controller.updateDestashNotification
  );
};
