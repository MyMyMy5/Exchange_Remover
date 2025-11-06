const { v4: uuidv4 } = require("uuid");

const requestContext = (req, res, next) => {
  const requestId = uuidv4();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
};

module.exports = requestContext;
