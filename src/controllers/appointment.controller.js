/**
 * DROP-IN: src/controllers/appointment.controller.js
 * Fields: userId, patientId, doctorId, appointmentDate (YYYY-MM-DD string), source.
 */

const crypto = require('crypto');
const Appointment = require('../models/Appointment');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const ReminderLog = require('../models/ReminderLog');

let User;
try {
  User = require('../models/User');
} catch {
  User = require('../models/User');
}

let assertAppointmentLimit = async () => {};
try {
  ({ assertAppointmentLimit } = require('./billing.controller'));
} catch {
  console.warn('assertAppointmentLimit missing — staff creates will skip the monthly cap');
}

let scheduleAppointmentReminders = async () => {};
try {
  ({ scheduleAppointmentReminders } = require('../services/reminderScheduler'));
} catch {
  console.warn('reminderScheduler missing');
}

let sendConfirmedEmail = async () => {};
let sendCancellationEmail = async () => {};
try {
  const mail = require('../services/emailService');
  sendConfirmedEmail = mail.sendConfirmedEmail || sendConfirmedEmail;
  sendCancellationEmail = mail.sendCancellationEmail || sendCancellationEmail;
} catch {
  try {
    const mail = require('../utils/sendEmail');
    sendConfirmedEmail = mail.sendConfirmedEmail || sendConfirmedEmail;
    sendCancellationEmail = mail.sendCancellationEmail || sendCancellationEmail;
  } catch {
    /* confirm/cancel still work without extra emails */
  }
}

function httpError(message, code, status, meta) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (meta) err.meta = meta;
  return err;
}

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('appointment', err);
  return res.status(status).json({
    success: false,
    code: err.code || 'APPOINTMENT_ERROR',
    message: err.message || 'Server error',
    ...(err.meta ? { meta: err.meta } : {}),
  });
}

function userIdOf(req) {
  return req.user && (req.user._id || req.user.id);
}

function weekdayKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ][d.getDay()];
}

function toMinutes(hhmm) {
  const parts = String(hhmm || '').split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function fromMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeTime(value) {
  const raw = String(value || '').trim();
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const mer = ampm[3].toUpperCase();
    if (mer === 'PM' && h < 12) h += 12;
    if (mer === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${ampm[2]}`;
  }
  const hm = raw.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return `${String(parseInt(hm[1], 10)).padStart(2, '0')}:${hm[2]}`;
  return raw;
}

function todayKey() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function dateAtMidnight(dateStr) {
  const value = new Date(`${dateStr}T00:00:00`);
  value.setHours(0, 0, 0, 0);
  return value;
}

function buildSlots(doctor, dateStr, takenTimes) {
  const day = weekdayKey(dateStr);
  const hours = doctor.workingHours && doctor.workingHours[day];
  if (!hours || !hours.enabled) return [];

  const start = toMinutes(hours.start || '09:00');
  const end = toMinutes(hours.end || '17:00');
  if (start == null || end == null || end <= start) return [];

  const duration = Number(doctor.slotDuration) || 30;
  const buffer = Number(doctor.bufferBetweenSlots) || 0;
  const step = duration + buffer;
  const taken = new Set((takenTimes || []).map(normalizeTime));

  let breakStart = null;
  let breakEnd = null;
  if (doctor.breakTime && doctor.breakTime.enabled) {
    breakStart = toMinutes(doctor.breakTime.start);
    breakEnd = toMinutes(doctor.breakTime.end);
  }

  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const isToday = dateStr === todayKey();
  const slots = [];

  for (let t = start; t + duration <= end; t += step) {
    if (
      breakStart != null &&
      breakEnd != null &&
      t < breakEnd &&
      t + duration > breakStart
    ) {
      continue;
    }
    if (isToday && t <= nowMins) continue;
    const time = fromMinutes(t);
    slots.push({ time, available: !taken.has(time) });
  }
  return slots;
}

async function takenTimesFor(userId, doctorId, dateStr) {
  const rows = await Appointment.find({
    userId,
    doctorId,
    appointmentDate: dateStr,
    confirmationStatus: { $nin: ['cancelled'] },
    status: { $nin: ['cancelled', 'canceled'] },
  })
    .select('appointmentTime')
    .lean();
  return rows.map((row) => normalizeTime(row.appointmentTime));
}

async function findOwnedDoctor(userId, doctorId) {
  const doctor = await Doctor.findOne({
    _id: doctorId,
    $or: [{ userId }, { user: userId }],
  });
  if (!doctor) throw httpError('Doctor not found', 'DOCTOR_NOT_FOUND', 404);
  if (doctor.isActive === false) {
    throw httpError('This doctor is not active', 'DOCTOR_INACTIVE', 400);
  }
  return doctor;
}

async function upsertPatient(userId, body) {
  const email = String(body.patientEmail || '').trim().toLowerCase();
  const name = String(body.patientName || '').trim();
  const phone = String(body.patientPhone || '').trim();
  const whatsapp = String(body.patientWhatsapp || phone).trim();
  const notes = String(body.notes || '').trim();

  let patient = email ? await Patient.findOne({ email, userId }) : null;
  if (!patient && phone) patient = await Patient.findOne({ phone, userId });

  if (patient) {
    const patch = { updatedAt: Date.now() };
    if (name) patch.name = name;
    if (phone) patch.phone = phone;
    if (whatsapp) patch.whatsapp = whatsapp;
    await Patient.updateOne({ _id: patient._id }, { $set: patch });
    return Patient.findById(patient._id);
  }

  return Patient.create({
    userId,
    name,
    email,
    phone: phone || '',
    whatsapp: whatsapp || '',
    notes: notes || '',
  });
}

async function attachPeople(appointments) {
  const patientIds = [
    ...new Set(appointments.map((a) => String(a.patientId || ''))),
  ].filter(Boolean);
  const doctorIds = [
    ...new Set(appointments.map((a) => String(a.doctorId || ''))),
  ].filter(Boolean);

  const [patients, doctors] = await Promise.all([
    Patient.find({ _id: { $in: patientIds } }).lean(),
    Doctor.find({ _id: { $in: doctorIds } }).lean(),
  ]);

  const patientMap = {};
  patients.forEach((p) => {
    patientMap[String(p._id)] = p;
  });
  const doctorMap = {};
  doctors.forEach((d) => {
    doctorMap[String(d._id)] = d;
  });

  return appointments.map((apt) => ({
    ...apt,
    source: apt.source || 'booking',
    patient: patientMap[String(apt.patientId)] || null,
    doctor: doctorMap[String(apt.doctorId)] || null,
  }));
}

async function cancelAllReminders(appointmentId) {
  try {
    const { cancelAllReminders: cancelQueueReminders } = require('../queues/backupQueue');
    await cancelQueueReminders(appointmentId);
  } catch (error) {
    console.error('Cancel queue reminders:', error.message);
  }

  await Appointment.findByIdAndUpdate(appointmentId, {
    reminder24hQueued: false,
    reminder24hProcessing: false,
    reminder2hQueued: false,
    reminder2hProcessing: false,
    reminder30minQueued: false,
    reminder30minProcessing: false,
  });
}

async function getAppointments(req, res) {
  try {
    const { status, dateFrom, dateTo, search } = req.query;
    const query = { userId: userIdOf(req) };

    if (status && status !== 'all') query.confirmationStatus = status;
    if (dateFrom) query.appointmentDate = { $gte: dateFrom };
    if (dateTo) {
      query.appointmentDate = { ...(query.appointmentDate || {}), $lte: dateTo };
    }

    let appointments = await Appointment.find(query)
      .sort({ appointmentDate: 1, appointmentTime: 1 })
      .lean();

    appointments = await attachPeople(appointments);

    if (search) {
      const q = String(search).toLowerCase();
      appointments = appointments.filter(
        (apt) =>
          apt.patient?.name?.toLowerCase().includes(q) ||
          apt.patient?.email?.toLowerCase().includes(q) ||
          apt.doctor?.name?.toLowerCase().includes(q)
      );
    }

    return res.json({ success: true, appointments });
  } catch (err) {
    return fail(res, err);
  }
}

async function getAppointmentById(req, res) {
  try {
    const appointment = await Appointment.findOne({
      _id: req.params.id,
      userId: userIdOf(req),
    });
    if (!appointment) {
      throw httpError('Appointment not found', 'NOT_FOUND', 404);
    }

    const [patient, doctor] = await Promise.all([
      Patient.findById(appointment.patientId),
      Doctor.findById(appointment.doctorId),
    ]);

    return res.json({
      success: true,
      appointment: {
        ...appointment.toObject(),
        source: appointment.source || 'booking',
        patient,
        doctor,
      },
    });
  } catch (err) {
    return fail(res, err);
  }
}

async function getAvailableSlots(req, res) {
  try {
    const userId = userIdOf(req);
    const doctorId = req.body && (req.body.doctorId || req.body.doctor);
    const dateStr = String((req.body && req.body.date) || '').slice(0, 10);
    if (!doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw httpError('doctorId and date (YYYY-MM-DD) are required', 'BAD_INPUT', 400);
    }
    const doctor = await findOwnedDoctor(userId, doctorId);
    const taken = await takenTimesFor(userId, doctor._id, dateStr);
    const slots = buildSlots(doctor, dateStr, taken);
    return res.json({ success: true, slots, date: dateStr });
  } catch (err) {
    return fail(res, err);
  }
}

async function createAppointment(req, res) {
  try {
    const userId = userIdOf(req);
    const limitInfo = await assertAppointmentLimit(userId);

    const body = req.body || {};
    const doctorId = body.doctorId || body.doctor;
    const dateStr = String(body.appointmentDate || body.date || '').slice(0, 10);
    const time = normalizeTime(body.appointmentTime || body.time);
    const name = String(body.patientName || body.name || '').trim();
    const email = String(body.patientEmail || body.email || '').trim();
    const phone = String(body.patientPhone || body.phone || '').trim();
    const whatsapp = String(body.patientWhatsapp || body.whatsapp || phone).trim();
    const notes = String(body.notes || '').trim();

    if (!doctorId) throw httpError('Pick a doctor', 'BAD_INPUT', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw httpError('Pick a date', 'BAD_INPUT', 400);
    if (!time) throw httpError('Pick a time slot', 'BAD_INPUT', 400);
    if (!name) throw httpError('Patient name is required', 'BAD_INPUT', 400);
    if (!email) throw httpError('Patient email is required', 'BAD_INPUT', 400);
    if (!phone) throw httpError('Patient phone is required', 'BAD_INPUT', 400);
    if (!whatsapp) throw httpError('WhatsApp number is required', 'BAD_INPUT', 400);
    if (dateStr < todayKey()) {
      throw httpError('Cannot add an appointment in the past', 'PAST_DATE', 400);
    }

    const doctor = await findOwnedDoctor(userId, doctorId);
    const slots = buildSlots(doctor, dateStr, await takenTimesFor(userId, doctor._id, dateStr));
    const open = slots.find((row) => row.time === time && row.available);
    if (!open) {
      throw httpError('That time is not open. Pick another slot.', 'SLOT_TAKEN', 409);
    }

    const duplicate = await Appointment.findOne({
      userId,
      doctorId: doctor._id,
      appointmentDate: dateStr,
      appointmentTime: time,
      confirmationStatus: { $nin: ['cancelled'] },
      status: { $nin: ['cancelled', 'canceled'] },
    });
    if (duplicate) {
      throw httpError('An appointment already exists at this time', 'SLOT_TAKEN', 400);
    }

    const patient = await upsertPatient(userId, {
      patientName: name,
      patientEmail: email,
      patientPhone: phone,
      patientWhatsapp: whatsapp,
      notes,
    });

    const appointment = await Appointment.create({
      userId,
      patientId: patient._id,
      doctorId: doctor._id,
      appointmentDate: dateStr,
      appointmentTime: time,
      status: 'scheduled',
      confirmationStatus: 'pending',
      source: 'manual',
      notes,
      confirmationToken: crypto.randomBytes(24).toString('hex'),
      cancellationToken: crypto.randomBytes(24).toString('hex'),
    });

    try {
      await scheduleAppointmentReminders(appointment);
    } catch (err) {
      console.error('scheduleAppointmentReminders', err.message);
    }

    try {
      const { maybeNotifyPlanLimit } = require('./booking.controller');
      void maybeNotifyPlanLimit({
        clinic: req.user,
        used: limitInfo && limitInfo.used != null ? Number(limitInfo.used) + 1 : null,
        limit: limitInfo && limitInfo.limit,
        planKey: limitInfo && limitInfo.planKey,
      });
    } catch (err) {
      console.error('maybeNotifyPlanLimit', err && err.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Appointment added',
      appointment,
    });
  } catch (err) {
    return fail(res, err);
  }
}

async function updateAppointment(req, res) {
  try {
    const {
      appointmentDate,
      appointmentTime,
      doctorId,
      notes,
      status,
      confirmationStatus,
    } = req.body || {};

    const appointment = await Appointment.findOneAndUpdate(
      { _id: req.params.id, userId: userIdOf(req) },
      {
        appointmentDate,
        appointmentTime,
        doctorId,
        notes,
        status,
        confirmationStatus,
        updatedAt: Date.now(),
      },
      { new: true, runValidators: true }
    );

    if (!appointment) throw httpError('Appointment not found', 'NOT_FOUND', 404);
    return res.json({ success: true, appointment });
  } catch (err) {
    return fail(res, err);
  }
}

async function deleteAppointment(req, res) {
  try {
    const appointment = await Appointment.findOneAndDelete({
      _id: req.params.id,
      userId: userIdOf(req),
    });
    if (!appointment) throw httpError('Appointment not found', 'NOT_FOUND', 404);
    try {
      await cancelAllReminders(appointment._id);
    } catch (err) {
      console.error('cancel reminders on delete', err.message);
    }
    return res.json({ success: true, message: 'Appointment deleted successfully' });
  } catch (err) {
    return fail(res, err);
  }
}

async function resendReminder(req, res) {
  try {
    const appointment = await Appointment.findOne({
      _id: req.params.id,
      userId: userIdOf(req),
    });
    if (!appointment) throw httpError('Appointment not found', 'NOT_FOUND', 404);
    try {
      await scheduleAppointmentReminders(appointment);
    } catch (err) {
      console.error('resend reminder', err.message);
    }
    return res.json({ success: true, message: 'Reminder queued' });
  } catch (err) {
    return fail(res, err);
  }
}

async function confirmByToken(req, res) {
  try {
    const { token } = req.params;
    const appointment = await Appointment.findOne({ confirmationToken: token });
    if (!appointment) {
      throw httpError(
        'Invalid or expired confirmation link. Please contact the clinic.',
        'NOT_FOUND',
        404
      );
    }

    if (appointment.confirmationStatus === 'confirmed') {
      return res.json({
        success: true,
        message: 'This appointment is already confirmed.',
        alreadyConfirmed: true,
        appointment: {
          id: appointment._id,
          date: appointment.appointmentDate,
          time: appointment.appointmentTime,
          status: appointment.confirmationStatus,
        },
      });
    }

    if (appointment.confirmationStatus === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'This appointment has been cancelled and cannot be confirmed.',
        alreadyCancelled: true,
        appointment: {
          id: appointment._id,
          date: appointment.appointmentDate,
          time: appointment.appointmentTime,
          status: appointment.confirmationStatus,
        },
      });
    }

    if (
      appointment.confirmationStatus !== 'pending' &&
      appointment.confirmationStatus !== 'no_response'
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm appointment with status: ${appointment.confirmationStatus}`,
        invalidStatus: true,
        currentStatus: appointment.confirmationStatus,
      });
    }

    const today = startOfToday();
    const appointmentDate = dateAtMidnight(appointment.appointmentDate);
    if (appointmentDate < today) {
      return res.status(400).json({
        success: false,
        message: 'This appointment is in the past and cannot be confirmed.',
        isPast: true,
      });
    }

    appointment.confirmationStatus = 'confirmed';
    appointment.status = 'confirmed';
    await appointment.save();

    try {
      await cancelAllReminders(appointment._id);
    } catch (err) {
      console.error('cancel reminders on confirm', err.message);
    }

    try {
      await ReminderLog.updateMany(
        {
          appointmentId: appointment._id,
          'status.current': { $in: ['pending', 'sent'] },
        },
        {
          $set: {
            'status.current': 'confirmed',
            'status.isPending': false,
            'status.isSent': true,
            'status.isDelivered': true,
            'status.isOpened': true,
            'status.isClicked': true,
            'status.isNoResponse': false,
            clickedAction: 'confirm',
            clicked: true,
            clickedAt: new Date(),
          },
        }
      );
    } catch (err) {
      console.error('update logs on confirm', err.message);
    }

    try {
      const [patient, doctor, clinic] = await Promise.all([
        Patient.findById(appointment.patientId),
        Doctor.findById(appointment.doctorId),
        User.findById(appointment.userId),
      ]);
      if (patient && patient.email) {
        await sendConfirmedEmail(
          appointment.userId,
          patient.email,
          patient.name || 'Patient',
          clinic && clinic.clinicName ? clinic.clinicName : 'Clinic',
          appointment.appointmentDate,
          appointment.appointmentTime,
          doctor && doctor.name ? doctor.name : 'Doctor',
          clinic && clinic.timezone ? clinic.timezone : 'Asia/Karachi'
        );
      }
    } catch (err) {
      console.error('confirm email', err.message);
    }

    return res.json({
      success: true,
      message: 'Your appointment has been confirmed successfully.',
      appointment: {
        id: appointment._id,
        date: appointment.appointmentDate,
        time: appointment.appointmentTime,
        status: appointment.confirmationStatus,
      },
    });
  } catch (err) {
    return fail(res, err);
  }
}

async function cancelByToken(req, res) {
  try {
    const { token } = req.params;
    const appointment = await Appointment.findOne({ cancellationToken: token });
    if (!appointment) {
      throw httpError(
        'Invalid or expired cancellation link. Please contact the clinic.',
        'NOT_FOUND',
        404
      );
    }

    if (appointment.confirmationStatus === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'This appointment has already been cancelled.',
        alreadyCancelled: true,
        appointment: {
          id: appointment._id,
          date: appointment.appointmentDate,
          time: appointment.appointmentTime,
          status: appointment.confirmationStatus,
        },
      });
    }

    if (appointment.confirmationStatus === 'confirmed') {
      return res.status(400).json({
        success: false,
        message: 'This appointment has already been confirmed and cannot be cancelled.',
        alreadyConfirmed: true,
        appointment: {
          id: appointment._id,
          date: appointment.appointmentDate,
          time: appointment.appointmentTime,
          status: appointment.confirmationStatus,
        },
      });
    }

    if (
      appointment.confirmationStatus !== 'pending' &&
      appointment.confirmationStatus !== 'no_response'
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel appointment with status: ${appointment.confirmationStatus}`,
        invalidStatus: true,
        currentStatus: appointment.confirmationStatus,
      });
    }

    const today = startOfToday();
    const appointmentDate = dateAtMidnight(appointment.appointmentDate);
    if (appointmentDate < today) {
      return res.status(400).json({
        success: false,
        message: 'This appointment is in the past and cannot be cancelled.',
        isPast: true,
      });
    }

    const now = new Date();
    const appointmentDateTime = new Date(
      `${appointment.appointmentDate}T${appointment.appointmentTime}`
    );
    const twoHoursBefore = new Date(appointmentDateTime.getTime() - 2 * 60 * 60 * 1000);
    if (now > twoHoursBefore) {
      return res.status(400).json({
        success: false,
        message:
          'Cannot cancel within 2 hours of the visit. Please contact the clinic directly.',
        withinTwoHours: true,
      });
    }

    appointment.confirmationStatus = 'cancelled';
    appointment.status = 'cancelled';
    await appointment.save();

    try {
      await cancelAllReminders(appointment._id);
    } catch (err) {
      console.error('cancel reminders on cancel', err.message);
    }

    try {
      await ReminderLog.updateMany(
        {
          appointmentId: appointment._id,
          'status.current': { $in: ['pending', 'sent'] },
        },
        {
          $set: {
            'status.current': 'cancelled',
            'status.isPending': false,
            'status.isSent': true,
            'status.isDelivered': true,
            'status.isOpened': true,
            'status.isClicked': true,
            'status.isNoResponse': false,
            clickedAction: 'cancel',
            clicked: true,
            clickedAt: new Date(),
          },
        }
      );
    } catch (err) {
      console.error('update logs on cancel', err.message);
    }

    try {
      const [patient, clinic] = await Promise.all([
        Patient.findById(appointment.patientId),
        User.findById(appointment.userId),
      ]);
      if (patient && patient.email) {
        await sendCancellationEmail(
          appointment.userId,
          patient.email,
          patient.name || 'Patient',
          clinic && clinic.clinicName ? clinic.clinicName : 'Clinic',
          appointment.appointmentDate,
          appointment.appointmentTime,
          clinic && clinic.timezone ? clinic.timezone : 'Asia/Karachi'
        );
      }
    } catch (err) {
      console.error('cancel email', err.message);
    }

    return res.json({
      success: true,
      message: 'Your appointment has been cancelled successfully.',
      appointment: {
        id: appointment._id,
        date: appointment.appointmentDate,
        time: appointment.appointmentTime,
        status: appointment.confirmationStatus,
      },
    });
  } catch (err) {
    return fail(res, err);
  }
}

async function getDetailsByToken(req, res) {
  try {
    const { token } = req.params;
    const appointment = await Appointment.findOne({
      $or: [{ confirmationToken: token }, { cancellationToken: token }],
    })
      .populate('doctorId', 'name specialty')
      .populate('patientId', 'name email phone')
      .populate('userId', 'clinicName');

    if (!appointment) throw httpError('Appointment not found', 'NOT_FOUND', 404);

    return res.json({
      success: true,
      appointment: {
        id: appointment._id,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        doctorName: appointment.doctorId && appointment.doctorId.name ? appointment.doctorId.name : 'N/A',
        doctorSpecialty:
          appointment.doctorId && appointment.doctorId.specialty
            ? appointment.doctorId.specialty
            : 'N/A',
        clinicName: appointment.userId && appointment.userId.clinicName ? appointment.userId.clinicName : 'N/A',
        patientName: appointment.patientId && appointment.patientId.name ? appointment.patientId.name : 'N/A',
        patientEmail: appointment.patientId && appointment.patientId.email ? appointment.patientId.email : 'N/A',
        patientPhone: appointment.patientId && appointment.patientId.phone ? appointment.patientId.phone : 'N/A',
        status: appointment.status,
        confirmationStatus: appointment.confirmationStatus,
        source: appointment.source || 'booking',
        isConfirmToken: appointment.confirmationToken === token,
        isCancelToken: appointment.cancellationToken === token,
        canConfirm:
          appointment.confirmationStatus !== 'confirmed' &&
          appointment.confirmationStatus !== 'cancelled',
        canCancel:
          appointment.confirmationStatus !== 'confirmed' &&
          appointment.confirmationStatus !== 'cancelled',
      },
    });
  } catch (err) {
    return fail(res, err);
  }
}

async function getStatusByToken(req, res) {
  try {
    const { token } = req.params;
    const appointment = await Appointment.findOne({
      $or: [{ confirmationToken: token }, { cancellationToken: token }],
    });
    if (!appointment) throw httpError('Appointment not found', 'NOT_FOUND', 404);

    return res.json({
      success: true,
      status: appointment.confirmationStatus,
      appointment: {
        id: appointment._id,
        date: appointment.appointmentDate,
        time: appointment.appointmentTime,
        status: appointment.confirmationStatus,
        isConfirmed: appointment.confirmationStatus === 'confirmed',
        isCancelled: appointment.confirmationStatus === 'cancelled',
        isPending: appointment.confirmationStatus === 'pending',
        isNoResponse: appointment.confirmationStatus === 'no_response',
      },
    });
  } catch (err) {
    return fail(res, err);
  }
}

module.exports = {
  getAppointments,
  getAppointmentById,
  getAvailableSlots,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  resendReminder,
  confirmByToken,
  cancelByToken,
  getDetailsByToken,
  getStatusByToken,
};
