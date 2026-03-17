const express = require('express');
const router = express.Router();
const {
    addTracking,
    checkTracking,
    listTracking,
    deleteTracking,
    removeTracking,
    checkNow,
    testEmail,
    testWhatsApp
} = require('../controllers/trackingController');

router.post('/add', addTracking);
router.get('/check/:email/:url', checkTracking);
router.get('/list/:email', listTracking);
router.delete('/delete/:id', deleteTracking);
router.delete('/remove/:email/:url', removeTracking);
router.post('/check-now/:id', checkNow);
router.post('/test-email/:id', testEmail);
router.post('/test-whatsapp/:id', testWhatsApp);

module.exports = router;
