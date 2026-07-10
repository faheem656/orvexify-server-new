// src/routes/templateRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const EmailTemplate = require('../models/EmailTemplate');
const defaultTemplates = require('../utils/defaultTemplates');

// ============ GET ALL TEMPLATES FOR USER ============
router.get('/templates', protect, async (req, res) => {
  try {
    let templates = await EmailTemplate.find({ userId: req.user._id });
    
    // If no templates exist, create defaults
    if (templates.length === 0) {
      const templateTypes = ['reminder', 'confirmation', 'cancellation'];
      
      for (const type of templateTypes) {
        const defaultTemplate = defaultTemplates[type];
        await EmailTemplate.create({
          userId: req.user._id,
          type: type,
          subject: defaultTemplate.subject,
          body: defaultTemplate.body,
          isDefault: true
        });
      }
      
      templates = await EmailTemplate.find({ userId: req.user._id });
    }
    
    // Convert to object with type as key
    const templatesObj = {};
    templates.forEach(template => {
      templatesObj[template.type] = {
        subject: template.subject,
        body: template.body
      };
    });
    
    res.json({
      success: true,
      templates: templatesObj
    });
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ============ UPDATE A SPECIFIC TEMPLATE ============
router.put('/templates/:type', protect, async (req, res) => {
  const { type } = req.params;
  const { subject, body } = req.body;
  
  if (!['reminder', 'confirmation', 'cancellation'].includes(type)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid template type'
    });
  }
  
  if (!subject || !body) {
    return res.status(400).json({
      success: false,
      message: 'Subject and body are required'
    });
  }
  
  try {
    let template = await EmailTemplate.findOne({
      userId: req.user._id,
      type: type
    });
    
    if (template) {
      // Update existing template
      template.subject = subject;
      template.body = body;
      template.isDefault = false;
      await template.save();
    } else {
      // Create new template
      template = await EmailTemplate.create({
        userId: req.user._id,
        type: type,
        subject: subject,
        body: body,
        isDefault: false
      });
    }
    
    res.json({
      success: true,
      message: `${type} template updated successfully`,
      template: {
        subject: template.subject,
        body: template.body
      }
    });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ============ RESET TO DEFAULT TEMPLATE ============
router.post('/templates/:type/reset', protect, async (req, res) => {
  const { type } = req.params;
  
  if (!['reminder', 'confirmation', 'cancellation'].includes(type)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid template type'
    });
  }
  
  try {
    const defaultTemplate = defaultTemplates[type];
    
    let template = await EmailTemplate.findOne({
      userId: req.user._id,
      type: type
    });
    
    if (template) {
      template.subject = defaultTemplate.subject;
      template.body = defaultTemplate.body;
      template.isDefault = true;
      await template.save();
    } else {
      template = await EmailTemplate.create({
        userId: req.user._id,
        type: type,
        subject: defaultTemplate.subject,
        body: defaultTemplate.body,
        isDefault: true
      });
    }
    
    res.json({
      success: true,
      message: `${type} template reset to default`,
      template: {
        subject: template.subject,
        body: template.body
      }
    });
  } catch (error) {
    console.error('Reset template error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;