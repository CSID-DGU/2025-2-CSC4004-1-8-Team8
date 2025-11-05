const express = require('express');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const mongoose = require('mongoose');
const router = express.Router();

router.use(requireJwtAuth);

router.get('/', async (req, res) => {
    const user = req.user;
    
})

module.exports = router;
