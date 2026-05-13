const { getHashRewardsStatus, redeemHashPoint } = require("../services/hashRewardsService");

function getAuthUserId(req) {
  return req.user?.userId || req.user?.id;
}

async function getStatus(req, res) {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json({ message: "No autorizado." });

    const status = await getHashRewardsStatus(userId);
    return res.json(status);
  } catch (error) {
    console.error("HASH REWARDS STATUS ERROR:", error);
    return res.status(500).json({
      message: "Error al cargar premios de hash.",
      detail: error.message,
    });
  }
}

async function syncStatus(req, res) {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json({ message: "No autorizado." });

    const status = await getHashRewardsStatus(userId);
    return res.json({
      message: status.addedPoints > 0
        ? `Se agregaron ${status.addedPoints} puntos hash nuevos.`
        : "No hay nuevos invitados válidos por agregar.",
      status,
    });
  } catch (error) {
    console.error("HASH REWARDS SYNC ERROR:", error);
    return res.status(500).json({
      message: "Error al actualizar puntos hash.",
      detail: error.message,
    });
  }
}

async function redeem(req, res) {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json({ message: "No autorizado." });

    const result = await redeemHashPoint(userId);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error("HASH REWARDS REDEEM ERROR:", error);
    return res.status(500).json({
      message: "Error al canjear punto hash.",
      detail: error.message,
    });
  }
}

module.exports = { getStatus, syncStatus, redeem };
