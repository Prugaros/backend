const authJwt = require("../middleware/authJwt.js");
const controller = require("../controllers/refund.controller");

module.exports = function(app) {
  app.use(function(req, res, next) {
    res.header(
      "Access-Control-Allow-Headers",
      "x-access-token, Origin, Content-Type, Accept"
    );
    next();
  });

  app.post(
    "/api/refunds",
    [authJwt.verifyToken],
    controller.createRefund
  );

  app.get(
    "/api/refunds/pending",
    [authJwt.verifyToken],
    controller.getPendingRefunds
  );

  app.put(
    "/api/refunds/:id",
    [authJwt.verifyToken],
    controller.updateRefundState
  );
};
