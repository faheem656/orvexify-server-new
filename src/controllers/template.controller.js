/**
 * DROP-IN: src/controllers/template.controller.js
 *
 * GET  /templates
 * PUT  /templates/:type
 * POST /templates/:type/reset
 *
 * Types: reminder | confirmation | cancellation
 * Email only. No SMS.
 */

const EmailTemplate = require('../models/EmailTemplate');
const defaultTemplates = require('../utils/defaultTemplates');

const TEMPLATE_TYPES = ['reminder', 'confirmation', 'cancellation'];

function httpError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('templates', err);
  return res.status(status).json({
    success: false,
    code: err.code || 'TEMPLATE_ERROR',
    message: err.message || 'Server error',
  });
}

function userIdOf(req) {
  return req.user && (req.user._id || req.user.id);
}

function assertType(type) {
  if (!TEMPLATE_TYPES.includes(type)) {
    throw httpError('Invalid template type', 'BAD_TEMPLATE', 400);
  }
}

function serializeOne(template) {
  return {
    subject: template.subject,
    body: template.body,
  };
}

function toMap(rows) {
  const templatesObj = {
    reminder: { subject: '', body: '' },
    confirmation: { subject: '', body: '' },
    cancellation: { subject: '', body: '' },
  };
  (rows || []).forEach((template) => {
    if (TEMPLATE_TYPES.includes(template.type)) {
      templatesObj[template.type] = serializeOne(template);
    }
  });
  return templatesObj;
}

async function ensureDefaults(userId) {
  let templates = await EmailTemplate.find({ userId });
  if (templates.length >= TEMPLATE_TYPES.length) return templates;

  const have = new Set(templates.map((t) => t.type));
  const missing = TEMPLATE_TYPES.filter((type) => !have.has(type)).map((type) => ({
    userId,
    type,
    subject: defaultTemplates[type].subject,
    body: defaultTemplates[type].body,
    isDefault: true,
  }));

  if (missing.length) {
    try {
      await EmailTemplate.insertMany(missing, { ordered: false });
    } catch (err) {
      if (!(err && err.code === 11000)) throw err;
    }
    templates = await EmailTemplate.find({ userId });
  }
  return templates;
}

async function getTemplates(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);
    const templates = await ensureDefaults(userId);
    return res.json({
      success: true,
      templates: toMap(templates),
    });
  } catch (error) {
    console.error('Get templates error:', error);
    return fail(res, error);
  }
}

async function updateTemplate(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const { type } = req.params;
    assertType(type);

    const subject = String((req.body && req.body.subject) || '').trim();
    const body = String((req.body && req.body.body) || '').trim();
    if (!subject || !body) {
      throw httpError('Subject and body are required', 'BAD_INPUT', 400);
    }

    const template = await EmailTemplate.findOneAndUpdate(
      { userId, type },
      {
        $set: { subject, body, isDefault: false },
        $setOnInsert: { userId, type },
      },
      { new: true, upsert: true, runValidators: true }
    );

    return res.json({
      success: true,
      message: `${type} template updated successfully`,
      template: serializeOne(template),
    });
  } catch (error) {
    console.error('Update template error:', error);
    return fail(res, error);
  }
}

async function resetTemplate(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const { type } = req.params;
    assertType(type);

    const def = defaultTemplates[type];
    const template = await EmailTemplate.findOneAndUpdate(
      { userId, type },
      {
        $set: {
          subject: def.subject,
          body: def.body,
          isDefault: true,
        },
        $setOnInsert: { userId, type },
      },
      { new: true, upsert: true, runValidators: true }
    );

    return res.json({
      success: true,
      message: `${type} template reset to default`,
      template: serializeOne(template),
    });
  } catch (error) {
    console.error('Reset template error:', error);
    return fail(res, error);
  }
}

module.exports = {
  getTemplates,
  updateTemplate,
  resetTemplate,
};
