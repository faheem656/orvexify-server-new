/**
 * DROP-IN: src/controllers/patient.controller.js
 *
 * GET    /patients
 * GET    /patients/:id
 * POST   /patients
 * PUT    /patients/:id
 * DELETE /patients/:id
 * POST   /patients/merge
 */

const Patient = require('../models/Patient');
const Appointment = require('../models/Appointment');

function loadDoctorModel() {
  try {
    return require('../models/Doctor');
  } catch {
    return require('../models/Doctor');
  }
}

function httpError(message, code, status, extra) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (extra) err.extra = extra;
  return err;
}

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('patient', err);
  return res.status(status).json({
    success: false,
    code: err.code || 'PATIENT_ERROR',
    message: err.message || 'Server error',
    ...(err.extra || {}),
  });
}

function userIdOf(req) {
  return req.user && (req.user._id || req.user.id);
}

function trimStr(value, max) {
  const text = String(value == null ? '' : value).trim();
  if (max && text.length > max) return text.slice(0, max);
  return text;
}

function normalizeEmail(value) {
  return trimStr(value, 120).toLowerCase();
}

function normalizePhone(value) {
  return trimStr(value, 40);
}

function statsFromAppointments(appointments) {
  const list = appointments || [];
  const confirmedCount = list.filter(
    (a) => a.confirmationStatus === 'confirmed'
  ).length;
  const noShowCount = list.filter((a) => a.status === 'no_show').length;
  const last = list.length
    ? list.reduce((latest, apt) => {
        const d = apt.appointmentDate;
        if (!latest) return d;
        return String(d) > String(latest) ? d : latest;
      }, null)
    : null;
  return {
    totalAppointments: list.length,
    lastVisit: last,
    noShowCount,
    confirmedRate: list.length ? (confirmedCount / list.length) * 100 : 0,
  };
}

async function findDuplicate(userId, email, phone, excludeId) {
  const or = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  if (!or.length) return null;
  const query = { userId, $or: or };
  if (excludeId) query._id = { $ne: excludeId };
  return Patient.findOne(query);
}

async function getPatients(req, res) {
  try {
    const userId = userIdOf(req);
    const { search, status } = req.query;
    const query = { userId };

    if (search) {
      const searchRegex = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }];
    }
    if (status && status !== 'all') query.status = status;

    const patients = await Patient.find(query).sort({ createdAt: -1 }).lean();
    const ids = patients.map((p) => p._id);

    const appointments =
      ids.length === 0
        ? []
        : await Appointment.find({ userId, patientId: { $in: ids } })
            .select('patientId appointmentDate status confirmationStatus')
            .lean();

    const byPatient = {};
    appointments.forEach((apt) => {
      const key = String(apt.patientId);
      if (!byPatient[key]) byPatient[key] = [];
      byPatient[key].push(apt);
    });

    const rows = patients.map((patient) => ({
      ...patient,
      ...statsFromAppointments(byPatient[String(patient._id)] || []),
    }));

    return res.json({ success: true, patients: rows });
  } catch (error) {
    console.error('Get patients error:', error);
    return fail(res, error);
  }
}

async function getPatientById(req, res) {
  try {
    const userId = userIdOf(req);
    const patient = await Patient.findOne({
      _id: req.params.id,
      userId,
    }).lean();

    if (!patient) throw httpError('Patient not found', 'NOT_FOUND', 404);

    const appointments = await Appointment.find({
      patientId: patient._id,
      userId,
    })
      .sort({ appointmentDate: -1 })
      .lean();

    const doctorIds = [
      ...new Set(appointments.map((a) => String(a.doctorId || '')).filter(Boolean)),
    ];
    let doctorMap = {};
    if (doctorIds.length) {
      const Doctor = loadDoctorModel();
      const doctors = await Doctor.find({ _id: { $in: doctorIds } })
        .select('name specialty')
        .lean();
      doctors.forEach((d) => {
        doctorMap[String(d._id)] = d;
      });
    }

    const withDoctors = appointments.map((apt) => ({
      ...apt,
      doctor: doctorMap[String(apt.doctorId)] || null,
    }));

    return res.json({
      success: true,
      patient: {
        ...patient,
        appointments: withDoctors,
        ...statsFromAppointments(appointments),
      },
    });
  } catch (error) {
    console.error('Get patient error:', error);
    return fail(res, error);
  }
}

async function createPatient(req, res) {
  try {
    const userId = userIdOf(req);
    const body = req.body || {};
    const name = trimStr(body.name, 120);
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone);

    if (!name) throw httpError('Patient name is required', 'BAD_INPUT', 400);
    if (!email) throw httpError('Patient email is required', 'BAD_INPUT', 400);
    if (!phone) throw httpError('Patient phone is required', 'BAD_INPUT', 400);

    const existingPatient = await findDuplicate(userId, email, phone);
    if (existingPatient) {
      const field = existingPatient.email === email ? 'email' : 'phone number';
      throw httpError(
        `A patient already exists with this ${field}`,
        'DUPLICATE',
        400,
        {
          existingPatient: {
            id: existingPatient._id,
            name: existingPatient.name,
            email: existingPatient.email,
            phone: existingPatient.phone,
          },
        }
      );
    }

    const patient = await Patient.create({
      userId,
      name,
      email,
      phone,
      whatsapp: trimStr(body.whatsapp || phone, 40),
      dateOfBirth: trimStr(body.dateOfBirth, 40),
      gender: trimStr(body.gender, 40),
      address: trimStr(body.address, 200),
      notes: trimStr(body.notes, 2000),
      status: 'active',
    });

    return res.status(201).json({ success: true, patient });
  } catch (error) {
    console.error('Create patient error:', error);
    return fail(res, error);
  }
}

async function updatePatient(req, res) {
  try {
    const userId = userIdOf(req);
    const body = req.body || {};
    const name = trimStr(body.name, 120);
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone);

    if (!name) throw httpError('Patient name is required', 'BAD_INPUT', 400);
    if (!email) throw httpError('Patient email is required', 'BAD_INPUT', 400);
    if (!phone) throw httpError('Patient phone is required', 'BAD_INPUT', 400);

    const existingPatient = await findDuplicate(userId, email, phone, req.params.id);
    if (existingPatient) {
      const field = existingPatient.email === email ? 'email' : 'phone number';
      throw httpError(
        `Another patient already exists with this ${field}`,
        'DUPLICATE',
        400
      );
    }

    const patch = {
      name,
      email,
      phone,
      dateOfBirth: trimStr(body.dateOfBirth, 40),
      gender: trimStr(body.gender, 40),
      address: trimStr(body.address, 200),
      notes: trimStr(body.notes, 2000),
      updatedAt: Date.now(),
    };
    if (body.whatsapp !== undefined) patch.whatsapp = trimStr(body.whatsapp, 40);
    if (body.status) patch.status = trimStr(body.status, 40);

    const patient = await Patient.findOneAndUpdate(
      { _id: req.params.id, userId },
      patch,
      { new: true, runValidators: true }
    );

    if (!patient) throw httpError('Patient not found', 'NOT_FOUND', 404);
    return res.json({ success: true, patient });
  } catch (error) {
    console.error('Update patient error:', error);
    return fail(res, error);
  }
}

async function deletePatient(req, res) {
  try {
    const userId = userIdOf(req);
    const count = await Appointment.countDocuments({
      patientId: req.params.id,
      userId,
    });

    if (count > 0) {
      throw httpError(
        `Cannot delete patient. This patient has ${count} appointment(s). Please reassign or delete appointments first.`,
        'HAS_APPOINTMENTS',
        400
      );
    }

    const patient = await Patient.findOneAndDelete({
      _id: req.params.id,
      userId,
    });
    if (!patient) throw httpError('Patient not found', 'NOT_FOUND', 404);

    return res.json({ success: true, message: 'Patient deleted successfully' });
  } catch (error) {
    console.error('Delete patient error:', error);
    return fail(res, error);
  }
}

async function mergePatients(req, res) {
  try {
    const userId = userIdOf(req);
    const primaryId = req.body && req.body.primaryId;
    const duplicateId = req.body && req.body.duplicateId;

    if (!primaryId || !duplicateId) {
      throw httpError('primaryId and duplicateId are required', 'BAD_INPUT', 400);
    }
    if (String(primaryId) === String(duplicateId)) {
      throw httpError('Cannot merge a patient into itself', 'BAD_INPUT', 400);
    }

    const [primary, duplicate] = await Promise.all([
      Patient.findOne({ _id: primaryId, userId }),
      Patient.findOne({ _id: duplicateId, userId }),
    ]);
    if (!primary || !duplicate) {
      throw httpError('Patient not found', 'NOT_FOUND', 404);
    }

    await Appointment.updateMany(
      { patientId: duplicateId, userId },
      { patientId: primaryId }
    );
    await Patient.findOneAndDelete({ _id: duplicateId, userId });

    return res.json({ success: true, message: 'Patients merged successfully' });
  } catch (error) {
    console.error('Merge patients error:', error);
    return fail(res, error);
  }
}

module.exports = {
  getPatients,
  getPatientById,
  createPatient,
  updatePatient,
  deletePatient,
  mergePatients,
};
