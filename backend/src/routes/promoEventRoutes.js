const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  getPromoEventStatus,
  claimPromoTask,
} = require("../controllers/promoEventController");

const router = express.Router();

router.use(authMiddleware);

router.get("/status", getPromoEventStatus);
router.post("/tasks/:taskCode/claim", claimPromoTask);

module.exports = router;
