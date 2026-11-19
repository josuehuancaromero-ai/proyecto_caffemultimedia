function requireLocal(req, res, next) {
  const address = req.socket.remoteAddress || req.ip;
  const isLocal =
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1";

  if (!isLocal) {
    return res.status(403).json({ error: "El panel solo está disponible localmente" });
  }
  return next();
}

module.exports = requireLocal;
