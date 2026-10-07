const transferService = require('../transfers/transfer.service');
const deliveryRepository = require('./delivery.repository');

exports.list = async (req, res, next) => {
  try {
    await transferService.getTransferForUser(req.params.id, req.user.id); // 404 / 403 handled here
    const deliveries = await deliveryRepository.listByTransfer(req.params.id);
    res.json({ transfer_id: req.params.id, deliveries });
  } catch (err) {
    next(err);
  }
};